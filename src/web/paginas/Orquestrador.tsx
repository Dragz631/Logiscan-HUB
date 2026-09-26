/**
 * ORQUESTRADOR DE REPASSE — Origem: RUAS (agrupadas por região operacional) → Destino: ajudantes.
 *
 * Fluxo principal: selecionar ruas → selecionar o ajudante → "Entregar ruas selecionadas ao <ajudante>".
 * A rua vai INTEIRA (todos os pacotes dela) para a carga do ajudante; o Street dele recebe sozinho.
 * Sem capacidade, sem "lotado": o card do ajudante só informa pacotes e ruas.
 * Nenhuma regra de negócio aqui: a tela mostra e chama a API.
 */
import { useMemo, useState } from 'react';
import type { ResumoPerfil, RuaNoOrquestrador } from '../../application/orquestracao';
import type { Regiao } from '../../domain/regioes';
import { api } from '../api';
import { useOperador } from '../contexto';
import { Aviso, useCarregar } from './comum';

export const ROTULO_ESTADO_RUA = { DISPONIVEL: 'Disponível', ATRIBUIDA: 'Atribuída', EM_ROTA: 'Em rota', CONCLUIDA: 'Concluída' } as const;
export const ROTULO_SITUACAO_PERFIL = { MONTADA: 'Carga montada', EM_ROTA: 'Em rota', CONCLUIDA: 'Rota concluída' } as const;

/** Barra de PROGRESSO (feitos / total). Não é capacidade. */
export function BarraProgresso({ feitos, total }: { feitos: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (feitos / total) * 100) : 0;
  return (
    <div className="barra" role="img" aria-label={`${feitos} de ${total} com desfecho`}>
      <span className="cheia" style={{ width: `${pct}%` }} />
    </div>
  );
}

const SEM_REGIAO = '__sem';
const NOVA_REGIAO = '__nova';

/** Escolha de região para uma rua: regiões conhecidas, nova região ou "sem região". */
function EscolhaRegiao({ r, regioes, onDefinir }: { r: RuaNoOrquestrador; regioes: Regiao[]; onDefinir: (valor: string) => void }) {
  const [valor, setValor] = useState('');
  return (
    <span className="escolha-regiao" onClick={(e) => e.preventDefault()}>
      <select value={valor} onChange={(e) => setValor(e.target.value)} aria-label={`Região de ${r.nome}`}>
        <option value="">{r.regiao.status === 'desconhecida' ? 'Qual região?' : 'Mudar região…'}</option>
        {regioes.map((g) => (
          <option key={g.id} value={g.id}>{g.nome}{g.repasseUnico ? ' (repasse como uma rua)' : ''}</option>
        ))}
        <option value={NOVA_REGIAO}>+ Nova região…</option>
        <option value={SEM_REGIAO}>Outras ruas do Caju (sem região)</option>
      </select>
      <button type="button" disabled={!valor} onClick={() => { onDefinir(valor); setValor(''); }}>
        Salvar
      </button>
    </span>
  );
}

const iniciais = (nome: string) =>
  nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

// ---------------------------------------------------------------------------
// Origem: rua (linha)
// ---------------------------------------------------------------------------

function LinhaRua({ r, marcada, nomes, regioes, onAlternar, onDefinirRegiao }: {
  r: RuaNoOrquestrador;
  marcada: boolean;
  nomes: Map<string, string>;
  regioes: Regiao[];
  onAlternar: () => void;
  onDefinirRegiao: (valor: string) => void;
}) {
  const [mudar, setMudar] = useState(false);
  const grupo = r.chave.startsWith('regiao:'); // região tratada como uma rua (ex.: Diversos)
  const selecionavel = r.disponiveis > 0;
  const com = r.responsaveis.map((id) => nomes.get(id) ?? '?').join(', ');
  return (
    <label className={`linha-rua ${marcada ? 'marcada' : ''} ${selecionavel ? '' : 'travada'}`}>
      <input type="checkbox" checked={marcada} disabled={!selecionavel} onChange={onAlternar} aria-label={`Selecionar ${r.nome}`} />
      <div className="info">
        <b>{r.nome}</b>
        <span className="fraco">
          {grupo ? `${r.logradouros.length} logradouro(s): ${r.logradouros.slice(0, 3).join(', ')}${r.logradouros.length > 3 ? '…' : ''}` : `${r.destinos} destino(s)`}
          {r.atribuidos > 0 && <> · {ROTULO_ESTADO_RUA[r.estado].toLowerCase()} → <b>{com}</b></>}
          {r.revisao > 0 && <span className="alerta-txt"> · {r.revisao} em revisão</span>}
        </span>
        {!grupo && (
          <button
            type="button"
            className={`link-mini ${r.regiao.status === 'desconhecida' ? 'alerta-txt' : ''}`}
            onClick={(e) => { e.preventDefault(); setMudar(!mudar); }}
          >
            {r.regiao.status === 'desconhecida' ? 'definir região' : 'mudar região'}
          </button>
        )}
        {!grupo && mudar && (
          <EscolhaRegiao r={r} regioes={regioes} onDefinir={(v) => { setMudar(false); onDefinirRegiao(v); }} />
        )}
      </div>
      <span className="qtd grande-qtd" title={r.disponiveis < r.total ? `${r.disponiveis} disponíveis de ${r.total}` : `${r.total} pacote(s)`}>
        {r.disponiveis > 0 ? r.disponiveis : r.total}
      </span>
    </label>
  );
}

interface Grupo {
  chave: string;
  titulo: string;
  ordem: number;
  ruas: RuaNoOrquestrador[];
}

/** Região a definir (precisa de você) → regiões conhecidas → Outras ruas do Caju (sem região). */
function agrupar(ruas: RuaNoOrquestrador[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const r of ruas) {
    const g =
      r.regiao.status === 'conhecida'
        ? { chave: r.regiao.id, titulo: r.regiao.nome, ordem: 1 }
        : r.regiao.status === 'sem_regiao'
          ? { chave: SEM_REGIAO, titulo: 'Outras ruas do Caju', ordem: 2 }
          : { chave: '__definir', titulo: 'Região a definir', ordem: 0 };
    if (!grupos.has(g.chave)) grupos.set(g.chave, { ...g, ruas: [] });
    grupos.get(g.chave)!.ruas.push(r);
  }
  return [...grupos.values()].sort((a, b) => a.ordem - b.ordem || a.titulo.localeCompare(b.titulo, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Destino: ajudante
// ---------------------------------------------------------------------------

function CardAjudante({ p, escolhido, aReceber, onEscolher }: {
  p: ResumoPerfil;
  escolhido: boolean;
  aReceber: { ruas: number; pacotes: number };
  onEscolher: () => void;
}) {
  const a = p.ajudante;
  const bloqueado = !a.ativo || p.carga?.situacao === 'EM_ROTA' || p.carga?.situacao === 'CONCLUIDA';
  return (
    <div className={`card-ajudante ${escolhido ? 'com-plano' : ''} ${bloqueado ? 'travado' : ''}`}>
      <button type="button" className="area" disabled={bloqueado} onClick={onEscolher} aria-pressed={escolhido}>
        <span className="avatar" aria-hidden="true">{iniciais(a.nome)}</span>
        <span className="quem">
          <b>{a.nome}</b>
          <span className="fraco">
            {a.veiculo ?? 'veículo não informado'}
            {p.carga ? ` · ${ROTULO_SITUACAO_PERFIL[p.carga.situacao]} ${p.carga.codigo}` : ' · sem carga'}
          </span>
        </span>
        <span className="contagem">
          <b className="qtd">{p.pacotes}</b> pacotes
          <br />
          <b className="qtd">{p.ruas}</b> ruas
        </span>
      </button>
      {p.pacotes > 0 && <BarraProgresso feitos={p.entregues + p.insucessos} total={p.pacotes} />}
      <div className="rodape-card">
        {escolhido && aReceber.ruas > 0 && (
          <span className="projecao-txt">
            +{aReceber.ruas} rua(s), +{aReceber.pacotes} pacote(s) ao entregar
          </span>
        )}
        {bloqueado && a.ativo && <span className="fraco">em rota — finalize antes de receber ruas</span>}
        {!a.ativo && <span className="fraco">inativo</span>}
        <a className="abrir" href={`#/ajudantes/${a.id}`}>perfil →</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function Orquestrador() {
  const { exigir } = useOperador();
  const dados = useCarregar(() => api.orquestrador(), []);
  const lotes = useCarregar(() => api.lotesResumo(), []);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [soDisponiveis, setSoDisponiveis] = useState(true);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const ruas = dados.dados?.ruas ?? [];
  const perfis = dados.dados?.perfis ?? [];
  const regioes = dados.dados?.regioes ?? [];
  const nomes = useMemo(() => new Map(perfis.map((p) => [p.ajudante.id, p.ajudante.nome])), [perfis]);
  const termo = busca.trim().toLowerCase();
  const visiveis = ruas
    .filter((r) => !soDisponiveis || r.disponiveis > 0)
    .filter(
      (r) =>
        !termo ||
        r.nome.toLowerCase().includes(termo) ||
        r.logradouros.some((l) => l.toLowerCase().includes(termo)) ||
        (r.regiao.status === 'conhecida' && r.regiao.nome.toLowerCase().includes(termo)),
    );
  const selecionadas = ruas.filter((r) => marcadas.has(r.chave));
  const pacotesSel = selecionadas.reduce((n, r) => n + r.disponiveis, 0);
  const perfilDestino = perfis.find((p) => p.ajudante.id === destino);
  const aguardando = ruas.filter((r) => r.disponiveis > 0).length;
  const statusLote = lotes.dados?.some((l) => l.status === 'PREVIA')
    ? { txt: 'Lote em prévia', cls: 'chip-alerta' }
    : lotes.dados?.some((l) => l.status === 'CONFIRMADO')
      ? { txt: 'Lote confirmado', cls: '' }
      : { txt: 'Sem lote', cls: '' };

  const alternar = (chave: string) => {
    const s = new Set(marcadas);
    if (s.has(chave)) s.delete(chave);
    else s.add(chave);
    setMarcadas(s);
  };

  async function definirRegiao(r: RuaNoOrquestrador, valor: string) {
    const ator = exigir();
    if (!ator) return;
    try {
      let regiaoId: string | null = valor === SEM_REGIAO ? null : valor;
      if (valor === NOVA_REGIAO) {
        const nome = prompt(`Nome da nova região para ${r.nome}:`)?.trim();
        if (!nome) return;
        regiaoId = (await api.criarRegiao(nome, ator)).id;
      }
      let res = await api.definirRegiao(r.nome, regiaoId, ator);
      if (!res.ok) {
        const para = regiaoId ? (regioes.find((g) => g.id === regiaoId)?.nome ?? 'a nova região') : 'Outras ruas do Caju';
        if (!confirm(`${res.conflito.rua} já está em "${res.conflito.atual.nome}". Mudar para "${para}"? (fica registrado no histórico)`)) return;
        res = await api.definirRegiao(r.nome, regiaoId, ator, true);
      }
      setMsg({ tipo: 'ok', texto: `${r.nome}: região salva na memória do HUB. Da próxima vez, é automático.` });
      dados.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  async function entregar() {
    const ator = exigir();
    if (!ator || !perfilDestino || selecionadas.length === 0) return;
    setEnviando(true);
    try {
      const r = await api.atribuirRuas(perfilDestino.ajudante.id, selecionadas.map((x) => x.chave), ator);
      setMsg({
        tipo: 'ok',
        texto: `${selecionadas.length} rua(s), ${r.pacotes} pacote(s) → ${perfilDestino.ajudante.nome} na carga ${r.carga.codigo} (montada). O Street dele recebe sozinho.`,
      });
      setMarcadas(new Set());
      dados.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Nada foi gravado: ${(e as Error).message}` });
    } finally {
      setEnviando(false);
    }
  }

  const rotuloBotao = perfilDestino
    ? `Entregar ${selecionadas.length || ''} rua(s) selecionada(s) ao ${perfilDestino.ajudante.nome}`
    : selecionadas.length
      ? 'Escolha o ajudante'
      : 'Selecione ruas e o ajudante';

  return (
    <section className="repasse">
      <div className="repasse-cabecalho">
        <div>
          <h1>Orquestrador de repasse</h1>
          <p className="fraco sem-margem">Selecione as ruas, escolha o ajudante e entregue. A rua vai inteira para a carga dele.</p>
        </div>
        <div className="acoes">
          <a href="#/importar" className={`chip chip-status ${statusLote.cls}`}>{statusLote.txt}</a>
          <button type="button" className="primario" disabled={!perfilDestino || selecionadas.length === 0 || enviando} onClick={entregar}>
            {rotuloBotao}
          </button>
        </div>
      </div>

      <div className="repasse-busca">
        <input type="search" placeholder="Buscar rua ou região…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {dados.erro && <Aviso>{dados.erro}</Aviso>}

      <div className="orquestrador">
        <div className="coluna painel">
          <div className="painel-topo">
            <h2>Origem (ruas)</h2>
            <span className="selo-contagem">{aguardando} aguardando</span>
          </div>
          <div className="filtros">
            <label className="check">
              <input type="checkbox" checked={soDisponiveis} onChange={(e) => setSoDisponiveis(e.target.checked)} /> só com pacotes disponíveis
            </label>
            {selecionadas.length > 0 && (
              <span className="dica sem-margem">
                {selecionadas.length} rua(s) · {pacotesSel} pacote(s) selecionados
              </span>
            )}
          </div>
          <div className="lista-cards">
            {agrupar(visiveis).map((g) => {
              const selecionaveis = g.ruas.filter((r) => r.disponiveis > 0);
              const todas = selecionaveis.length > 0 && selecionaveis.every((r) => marcadas.has(r.chave));
              const total = g.ruas.reduce((n, r) => n + (r.disponiveis || r.total), 0);
              return (
                <div key={g.chave} className={`grupo-regiao ${g.chave === '__definir' ? 'a-definir' : ''}`}>
                  <div className="grupo-topo">
                    <label>
                      <input
                        type="checkbox"
                        disabled={selecionaveis.length === 0}
                        checked={todas}
                        onChange={() => {
                          const s = new Set(marcadas);
                          selecionaveis.forEach((r) => (todas ? s.delete(r.chave) : s.add(r.chave)));
                          setMarcadas(s);
                        }}
                        aria-label={`Selecionar todas as ruas de ${g.titulo}`}
                      />
                      <b>{g.titulo}</b>
                    </label>
                    <span className="fraco">
                      {g.ruas.length} rua(s) · {total} pacote(s)
                    </span>
                  </div>
                  {g.chave === '__definir' && <p className="fraco sem-margem">Ruas que o HUB ainda não conhece: diga a região uma vez e ele lembra.</p>}
                  {g.ruas.map((r) => (
                    <LinhaRua
                      key={r.chave}
                      r={r}
                      marcada={marcadas.has(r.chave)}
                      nomes={nomes}
                      regioes={regioes}
                      onAlternar={() => alternar(r.chave)}
                      onDefinirRegiao={(v) => definirRegiao(r, v)}
                    />
                  ))}
                </div>
              );
            })}
            {dados.dados && visiveis.length === 0 && (
              <p className="fraco centro">
                {ruas.length === 0 ? <>Nenhum pacote na operação. <a href="#/importar">Importe um lote</a>.</> : 'Nenhuma rua com esse filtro.'}
              </p>
            )}
          </div>
        </div>

        <div className="coluna painel">
          <div className="painel-topo">
            <h2>Destino (ajudantes)</h2>
            <span className="selo-contagem">{perfis.filter((p) => p.ajudante.ativo).length} ativos</span>
          </div>
          <div className="lista-cards">
            {perfis.map((p) => (
              <CardAjudante
                key={p.ajudante.id}
                p={p}
                escolhido={destino === p.ajudante.id}
                aReceber={{ ruas: selecionadas.length, pacotes: pacotesSel }}
                onEscolher={() => setDestino(destino === p.ajudante.id ? null : p.ajudante.id)}
              />
            ))}
            {dados.dados && perfis.length === 0 && (
              <p className="fraco centro">Nenhum ajudante. <a href="#/ajudantes">Cadastre um perfil</a>.</p>
            )}
          </div>
        </div>
      </div>

      {(selecionadas.length > 0 || perfilDestino) && (
        <div className="barra-acao fixa">
          <span>
            <b>{selecionadas.length}</b> rua(s) · <b>{pacotesSel}</b> pacote(s)
            {perfilDestino ? <> → <b>{perfilDestino.ajudante.nome}</b></> : <span className="fraco"> — escolha o ajudante</span>}
          </span>
          <button type="button" className="primario" disabled={!perfilDestino || selecionadas.length === 0 || enviando} onClick={entregar}>
            {rotuloBotao}
          </button>
        </div>
      )}
    </section>
  );
}
