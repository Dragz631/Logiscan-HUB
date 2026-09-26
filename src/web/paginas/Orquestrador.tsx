/**
 * ORQUESTRADOR DE REPASSE — Origem: UNIDADES (região, grupo ou rua) → Destino: ajudantes.
 *
 * Primeiro "quanto tem aqui?" (cards resumidos), depois "quais ruas estão dentro?" (Expandir).
 * Fluxo: selecionar card(s) → selecionar o ajudante → "Entregar N unidade(s) ao <ajudante>" → carga MONTADA
 * → INICIAR ROTA no próprio card do ajudante → o Street dele recebe sozinho.
 * A rua vai sempre INTEIRA. Sem capacidade/"lotado". Nenhuma regra de negócio aqui: a tela mostra e chama a API.
 */
import { useMemo, useState } from 'react';
import type { ResumoPerfil, RuaNoOrquestrador, UnidadeRepasse } from '../../application/orquestracao';
import type { Regiao } from '../../domain/regioes';
import { api } from '../api';
import { useOperador } from '../contexto';
import { dataHora } from '../formato';
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

function LinhaRua({ r, marcada, incluida, nomes, regioes, onAlternar, onDefinirRegiao }: {
  r: RuaNoOrquestrador;
  marcada: boolean;
  /** A região inteira está selecionada: a rua já vai junto. */
  incluida?: boolean;
  nomes: Map<string, string>;
  regioes: Regiao[];
  onAlternar: () => void;
  onDefinirRegiao: (valor: string) => void;
}) {
  const [mudar, setMudar] = useState(false);
  const grupo = r.chave.startsWith('regiao:'); // região tratada como uma rua (ex.: Diversos)
  const selecionavel = r.disponiveis > 0 && !incluida;
  const com = r.responsaveis.map((id) => nomes.get(id) ?? '?').join(', ');
  return (
    <label className={`linha-rua ${marcada || (incluida && r.disponiveis > 0) ? 'marcada' : ''} ${selecionavel || incluida ? '' : 'travada'}`}>
      <input type="checkbox" checked={marcada || (!!incluida && r.disponiveis > 0)} disabled={!selecionavel} onChange={onAlternar} aria-label={`Selecionar ${r.nome}`} />
      <div className="info">
        <b>{r.nome}</b>
        <span className="fraco">
          {grupo ? `${r.logradouros.length} logradouro(s): ${r.logradouros.join(', ')}` : `${r.destinos} destino(s)`}
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

// ---------------------------------------------------------------------------
// Origem: unidade (card resumido; ruas só ao expandir)
// ---------------------------------------------------------------------------

function resumoUnidade(u: UnidadeRepasse): string {
  const pac = `${u.total} pacote${u.total === 1 ? '' : 's'}`;
  if (u.tipo === 'grupo') return `${pac} · 1 rua operacional (${u.ruas[0]?.logradouros.length ?? 0} logradouro(s))`;
  if (u.tipo === 'regiao') return `${pac} · ${u.ruas.length} rua${u.ruas.length === 1 ? '' : 's'}`;
  return `${pac} · ${u.ruas[0]?.destinos ?? 0} destino(s)`;
}

function CardUnidade({ u, marcadas, nomes, regioes, onAlternar, onDefinirRegiao }: {
  u: UnidadeRepasse;
  marcadas: Set<string>;
  nomes: Map<string, string>;
  regioes: Regiao[];
  onAlternar: (chave: string) => void;
  onDefinirRegiao: (r: RuaNoOrquestrador, valor: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [mudar, setMudar] = useState(false);
  const inteira = marcadas.has(u.chave);
  const algumaRua = u.tipo === 'regiao' && u.ruas.some((r) => marcadas.has(r.chave));
  const selecionavel = u.disponiveis > 0;
  const com = u.responsaveis.map((id) => nomes.get(id) ?? '?').join(', ');
  const rua = u.tipo === 'rua' ? u.ruas[0] : null;
  const definir = u.regiao.status === 'desconhecida';
  return (
    <div className={`card-unidade ${inteira ? 'marcada' : algumaRua ? 'parcial' : ''} ${selecionavel ? '' : 'travada'}`}>
      <label className="topo">
        <input type="checkbox" checked={inteira} disabled={!selecionavel} onChange={() => onAlternar(u.chave)} aria-label={`Selecionar ${u.nome}`} />
        <span className="info">
          <b>{u.nome}</b>
          <span className="fraco">
            {resumoUnidade(u)}
            {u.atribuidos > 0 && <> · {u.disponiveis > 0 ? `${u.atribuidos} já com` : 'com'} <b>{com}</b></>}
            {u.revisao > 0 && <span className="alerta-txt"> · {u.revisao} em revisão</span>}
            {algumaRua && <span className="projecao-txt"> · {u.ruas.filter((r) => marcadas.has(r.chave)).length} rua(s) escolhida(s)</span>}
          </span>
        </span>
        <span className="qtd grande-qtd" title={`${u.disponiveis} disponíveis de ${u.total}`}>{u.disponiveis > 0 ? u.disponiveis : u.total}</span>
      </label>
      <div className="acoes-unidade">
        {u.tipo !== 'rua' && (
          <button type="button" className="link-mini" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
            {aberto ? 'Recolher ▴' : u.tipo === 'grupo' ? 'Ver logradouros ▾' : 'Expandir ▾'}
          </button>
        )}
        {rua && (
          <button type="button" className={`link-mini ${definir ? 'alerta-txt' : ''}`} onClick={() => setMudar(!mudar)}>
            {definir ? 'região não definida · definir' : 'colocar numa região'}
          </button>
        )}
        {!selecionavel && u.total > 0 && <span className="fraco">sem pacotes disponíveis</span>}
      </div>
      {rua && mudar && <EscolhaRegiao r={rua} regioes={regioes} onDefinir={(v) => { setMudar(false); onDefinirRegiao(rua, v); }} />}
      {aberto && u.tipo === 'regiao' && (
        <div className="ruas-da-unidade">
          {u.ruas.map((r) => (
            <LinhaRua
              key={r.chave}
              r={r}
              marcada={marcadas.has(r.chave)}
              incluida={inteira}
              nomes={nomes}
              regioes={regioes}
              onAlternar={() => onAlternar(r.chave)}
              onDefinirRegiao={(v) => onDefinirRegiao(r, v)}
            />
          ))}
        </div>
      )}
      {aberto && u.tipo === 'grupo' && (
        <ul className="logradouros">
          {u.ruas[0]?.logradouros.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Destino: ajudante
// ---------------------------------------------------------------------------

/** Por que o ajudante não pode receber repasse agora (null = pode). Motivo sempre explícito na tela. */
function motivoBloqueio(p: ResumoPerfil): string | null {
  if (!p.ajudante.ativo) return 'Inativo — não recebe repasse. Ative o perfil em Ajudantes.';
  if (p.carga?.situacao === 'EM_ROTA') return `Em rota com ${p.carga.codigo} desde ${dataHora(p.rotaIniciadaEm)} — carga fechada, não recebe novas ruas.`;
  if (p.carga?.situacao === 'CONCLUIDA') return `Rota concluída (${p.carga.codigo}) — finalize a carga no perfil para receber novas ruas.`;
  return null;
}

function CardAjudante({ p, escolhido, aReceber, iniciando, onEscolher, onIniciarRota }: {
  p: ResumoPerfil;
  escolhido: boolean;
  aReceber: { unidades: number; pacotes: number };
  iniciando: boolean;
  onEscolher: () => void;
  onIniciarRota: () => void;
}) {
  const a = p.ajudante;
  const bloqueio = motivoBloqueio(p);
  const montada = p.carga?.situacao === 'MONTADA';
  return (
    <div className={`card-ajudante ${escolhido ? 'com-plano' : ''} ${bloqueio ? (a.ativo ? 'fechado' : 'travado') : ''}`}>
      <button type="button" className="area" disabled={!!bloqueio} onClick={onEscolher} aria-pressed={escolhido}>
        <span className="avatar" aria-hidden="true">{iniciais(a.nome)}</span>
        <span className="quem">
          <b>{a.nome}</b>
          <span className="fraco">
            {a.ativo ? <span className="chip chip-ativo">ATIVO</span> : <span className="chip chip-inativo">INATIVO</span>}
            {p.carga ? ` ${ROTULO_SITUACAO_PERFIL[p.carga.situacao]} · ${p.carga.codigo}` : ' sem carga'}
          </span>
        </span>
        <span className="contagem">
          <b className="qtd">{p.pacotes}</b> pacotes
          <br />
          <b className="qtd">{p.ruas}</b> ruas
        </span>
      </button>
      {p.pacotes > 0 && <BarraProgresso feitos={p.entregues + p.insucessos} total={p.pacotes} />}
      {bloqueio && (
        <p className="motivo" role="note">
          {bloqueio} {!a.ativo && <a href="#/ajudantes">Ir para Ajudantes →</a>}
        </p>
      )}
      {montada && (
        <div className="acao-rota">
          <span className="chip perfil-MONTADA">MONTADA</span>
          <button type="button" className="primario" disabled={iniciando} onClick={onIniciarRota}>
            {iniciando ? 'Iniciando…' : 'INICIAR ROTA'}
          </button>
        </div>
      )}
      <div className="rodape-card">
        {escolhido && aReceber.unidades > 0 && (
          <span className="projecao-txt">+{aReceber.unidades} unidade(s), +{aReceber.pacotes} pacote(s) ao entregar</span>
        )}
        {p.carga && !escolhido && (
          <span className="fraco">{p.recebidaNoStreetEm ? `no Street ✓ ${dataHora(p.recebidaNoStreetEm)}` : 'Street ainda não carregou (recebe sozinho)'}</span>
        )}
        <a className="abrir" href={`#/ajudantes/${a.id}`}>perfil →</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

const casa = (termo: string, u: UnidadeRepasse) =>
  !termo ||
  u.nome.toLowerCase().includes(termo) ||
  u.ruas.some((r) => r.nome.toLowerCase().includes(termo) || r.logradouros.some((l) => l.toLowerCase().includes(termo)));

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
  const [iniciando, setIniciando] = useState<string | null>(null);

  const unidades = dados.dados?.unidades ?? [];
  const perfis = dados.dados?.perfis ?? [];
  const regioes = dados.dados?.regioes ?? [];
  const nomes = useMemo(() => new Map(perfis.map((p) => [p.ajudante.id, p.ajudante.nome])), [perfis]);
  const termo = busca.trim().toLowerCase();
  const visiveis = unidades.filter((u) => (!soDisponiveis || u.disponiveis > 0) && casa(termo, u));

  // O que está selecionado: unidades inteiras e/ou ruas avulsas de uma região (sem contar pacote duas vezes).
  const selecao = useMemo(() => {
    let pacotes = 0;
    const nomesSel: string[] = [];
    for (const u of unidades) {
      if (marcadas.has(u.chave)) {
        pacotes += u.disponiveis;
        nomesSel.push(u.nome);
        continue;
      }
      if (u.tipo !== 'regiao') continue;
      for (const r of u.ruas) if (marcadas.has(r.chave)) { pacotes += r.disponiveis; nomesSel.push(r.nome); }
    }
    return { pacotes, nomes: nomesSel };
  }, [unidades, marcadas]);
  const qtdSel = selecao.nomes.length;
  const perfilDestino = perfis.find((p) => p.ajudante.id === destino);
  const aguardando = unidades.filter((u) => u.disponiveis > 0).length;
  const statusLote = lotes.dados?.some((l) => l.status === 'PREVIA')
    ? { txt: 'Lote em prévia', cls: 'chip-alerta' }
    : lotes.dados?.some((l) => l.status === 'CONFIRMADO')
      ? { txt: 'Lote confirmado', cls: '' }
      : { txt: 'Sem lote', cls: '' };

  /** Selecionar a região inteira tira as ruas avulsas dela (e vice-versa): nada entra duas vezes. */
  const alternar = (chave: string) => {
    const s = new Set(marcadas);
    const unidade = unidades.find((u) => u.chave === chave);
    if (s.has(chave)) s.delete(chave);
    else {
      s.add(chave);
      if (unidade) unidade.ruas.forEach((r) => r.chave !== chave && s.delete(r.chave));
      const dona = unidades.find((u) => u.tipo === 'regiao' && u.chave !== chave && u.ruas.some((r) => r.chave === chave));
      if (dona) s.delete(dona.chave);
    }
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
        const para = regiaoId ? (regioes.find((g) => g.id === regiaoId)?.nome ?? 'a nova região') : 'sem região';
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
    if (!ator || !perfilDestino || marcadas.size === 0) return;
    setEnviando(true);
    try {
      const r = await api.atribuirRuas(perfilDestino.ajudante.id, [...marcadas], ator);
      const fora = r.deFora.length
        ? ` Ficou de fora (uma rua não fica com dois ajudantes): ${r.deFora.map((d) => `${d.rua} — ${d.pacotes} pacote(s) continua(m) no galpão, a rua já está com ${d.com}`).join('; ')}.`
        : '';
      setMsg({
        tipo: r.deFora.length ? 'info' : 'ok',
        texto: `${r.ruas.length} rua(s), ${r.pacotes} pacote(s) → ${perfilDestino.ajudante.nome} na carga ${r.carga.codigo} (MONTADA). Quando estiver pronto, clique em INICIAR ROTA no card dele.${fora}`,
      });
      setMarcadas(new Set());
      dados.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Nada foi gravado: ${(e as Error).message}` });
    } finally {
      setEnviando(false);
    }
  }

  async function iniciarRota(p: ResumoPerfil) {
    const ator = exigir();
    if (!ator || !p.carga) return;
    if (!confirm(`Confirmar início da rota de ${p.ajudante.nome}?\n\nCarga ${p.carga.codigo}: ${p.pacotes} pacote(s), ${p.ruas} rua(s).\nDepois de iniciar, a carga fica FECHADA (não recebe nem perde ruas).`)) return;
    setIniciando(p.ajudante.id);
    try {
      const r = await api.iniciarRota(p.carga.id, ator);
      setMsg({
        tipo: 'ok',
        texto: r.jaIniciada
          ? `A rota de ${p.ajudante.nome} já estava iniciada (${dataHora(r.rotaIniciadaEm)}).`
          : `Rota de ${p.ajudante.nome} iniciada às ${dataHora(r.rotaIniciadaEm)}. Carga ${p.carga.codigo} EM ROTA — o Street dele recebe sozinho.`,
      });
      if (destino === p.ajudante.id) setDestino(null); // carga fechada: não é mais destino de repasse
      dados.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `A rota não foi iniciada: ${(e as Error).message}` });
    } finally {
      setIniciando(null);
    }
  }

  const rotuloBotao = perfilDestino
    ? `Entregar ${qtdSel || ''} unidade(s) ao ${perfilDestino.ajudante.nome}`
    : qtdSel
      ? 'Escolha o ajudante'
      : 'Selecione cards e o ajudante';
  const podeEntregar = !!perfilDestino && qtdSel > 0 && !enviando && !motivoBloqueio(perfilDestino);

  return (
    <section className="repasse">
      <div className="repasse-cabecalho">
        <div>
          <h1>Orquestrador de repasse</h1>
          <p className="fraco sem-margem">Selecione os cards, escolha o ajudante e entregue. Depois, inicie a rota no card dele.</p>
        </div>
        <div className="acoes">
          <a href="#/importar" className={`chip chip-status ${statusLote.cls}`}>{statusLote.txt}</a>
          <button type="button" className="primario" disabled={!podeEntregar} onClick={entregar}>
            {rotuloBotao}
          </button>
        </div>
      </div>

      <div className="repasse-busca">
        <input type="search" placeholder="Buscar região ou rua…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {dados.erro && <Aviso>{dados.erro}</Aviso>}

      <div className="orquestrador">
        <div className="coluna painel">
          <div className="painel-topo">
            <h2>Origem</h2>
            <span className="selo-contagem">{aguardando} aguardando</span>
          </div>
          <div className="filtros">
            <label className="check">
              <input type="checkbox" checked={soDisponiveis} onChange={(e) => setSoDisponiveis(e.target.checked)} /> só com pacotes disponíveis
            </label>
            {qtdSel > 0 && (
              <span className="dica sem-margem">
                {qtdSel} selecionada(s) · {selecao.pacotes} pacote(s)
              </span>
            )}
          </div>
          <div className="lista-cards">
            {visiveis.map((u) => (
              <CardUnidade
                key={u.chave}
                u={u}
                marcadas={marcadas}
                nomes={nomes}
                regioes={regioes}
                onAlternar={alternar}
                onDefinirRegiao={definirRegiao}
              />
            ))}
            {dados.dados && visiveis.length === 0 && (
              <p className="fraco centro">
                {unidades.length === 0 ? <>Nenhum pacote na operação. <a href="#/importar">Importe um lote</a>.</> : 'Nada com esse filtro.'}
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
                aReceber={{ unidades: qtdSel, pacotes: selecao.pacotes }}
                iniciando={iniciando === p.ajudante.id}
                onEscolher={() => setDestino(destino === p.ajudante.id ? null : p.ajudante.id)}
                onIniciarRota={() => iniciarRota(p)}
              />
            ))}
            {dados.dados && perfis.length === 0 && (
              <p className="fraco centro">Nenhum ajudante. <a href="#/ajudantes">Cadastre um perfil</a>.</p>
            )}
          </div>
        </div>
      </div>

      {(qtdSel > 0 || perfilDestino) && (
        <div className="barra-acao fixa">
          <span>
            <b>{qtdSel}</b> unidade(s) · <b>{selecao.pacotes}</b> pacote(s)
            {perfilDestino ? <> → <b>{perfilDestino.ajudante.nome}</b></> : <span className="fraco"> — escolha o ajudante</span>}
          </span>
          <button type="button" className="primario" disabled={!podeEntregar} onClick={entregar}>
            {rotuloBotao}
          </button>
        </div>
      )}
    </section>
  );
}
