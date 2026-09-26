/**
 * ORQUESTRADOR DE REPASSE — Origem (ruas) → Destino (ajudantes).
 *
 * Fluxo: selecionar rua(s) → clicar no ajudante (ou arrastar a rua até ele) → a rua entra no PLANO →
 * "Confirmar repasses" grava tudo de uma vez (tudo ou nada). Arrastar é opcional: tudo funciona só com clique.
 * Nenhuma regra de negócio aqui: o plano é só estado da tela; quem decide/valida é o HUB ao confirmar.
 */
import { useMemo, useState } from 'react';
import type { ResumoPerfil, RuaNoOrquestrador } from '../../application/orquestracao';
import type { Regiao } from '../../domain/regioes';
import { api } from '../api';
import { useOperador } from '../contexto';
import { Aviso, useCarregar } from './comum';

export const ROTULO_ESTADO_RUA = { DISPONIVEL: 'Disponível', ATRIBUIDA: 'Atribuída', EM_ROTA: 'Em rota', CONCLUIDA: 'Concluída' } as const;
export const ROTULO_SITUACAO_PERFIL = { MONTADA: 'Carga montada', EM_ROTA: 'Em rota', CONCLUIDA: 'Rota concluída' } as const;

export function BarraCapacidade({ atual, projetado = 0, capacidade }: { atual: number; projetado?: number; capacidade: number | null }) {
  const limite = Math.max(capacidade ?? 0, atual + projetado, 1);
  const pct = (n: number) => `${Math.min(100, (n / limite) * 100)}%`;
  const excede = capacidade !== null && atual + projetado > capacidade;
  return (
    <div className={`barra ${excede ? 'excede' : ''}`} role="img" aria-label={`${atual + projetado} de ${capacidade ?? 'sem limite'} pacotes`}>
      <span className="cheia" style={{ width: pct(atual) }} />
      {projetado > 0 && <span className="projetada" style={{ left: pct(atual), width: pct(projetado) }} />}
    </div>
  );
}

const SEM_REGIAO = '__sem';
const NOVA_REGIAO = '__nova';
const A_DEFINIR = '__definir';

/** Escolha de região para uma rua: regiões conhecidas, nova região ou "sem região". */
function EscolhaRegiao({ r, regioes, onDefinir }: { r: RuaNoOrquestrador; regioes: Regiao[]; onDefinir: (valor: string) => void }) {
  const [valor, setValor] = useState('');
  return (
    <span className="escolha-regiao" onClick={(e) => e.preventDefault()}>
      <select value={valor} onChange={(e) => setValor(e.target.value)} aria-label={`Região de ${r.nome}`}>
        <option value="">{r.regiao.status === 'desconhecida' ? 'Qual região?' : 'Mudar região…'}</option>
        {regioes.map((g) => (
          <option key={g.id} value={g.id}>{g.nome}</option>
        ))}
        <option value={NOVA_REGIAO}>+ Nova região…</option>
        <option value={SEM_REGIAO}>Deixar sem região</option>
      </select>
      <button type="button" disabled={!valor} onClick={() => { onDefinir(valor); setValor(''); }}>
        Salvar
      </button>
    </span>
  );
}

function IconeRua() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20 9 4M20 20 15 4M12 6v2M12 11v2M12 16v2" />
    </svg>
  );
}

const iniciais = (nome: string) =>
  nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

// ---------------------------------------------------------------------------
// Origem: rua
// ---------------------------------------------------------------------------

function TileRua({ r, marcada, planejadoPara, nomes, regioes, onAlternar, onDefinirRegiao, onArrastar }: {
  r: RuaNoOrquestrador;
  marcada: boolean;
  planejadoPara: string | null;
  nomes: Map<string, string>;
  regioes: Regiao[];
  onAlternar: () => void;
  onDefinirRegiao: (valor: string) => void;
  onArrastar: () => void;
}) {
  const [mudarRegiao, setMudarRegiao] = useState(false);
  const selecionavel = r.disponiveis > 0;
  const com = r.responsaveis.map((id) => nomes.get(id) ?? '?').join(', ');
  const regiaoTxt = r.regiao.status === 'conhecida' ? r.regiao.nome : r.regiao.status === 'sem_regiao' ? 'Sem região' : 'Região a definir';
  return (
    <label
      className={`tile-rua ${marcada ? 'marcada' : ''} ${selecionavel ? '' : 'travada'} ${planejadoPara ? 'planejada' : ''}`}
      draggable={selecionavel}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', r.chave);
        e.dataTransfer.effectAllowed = 'move';
        onArrastar();
      }}
    >
      <div className="faixa">
        <span className={`estado-rua rua-${r.estado}`}>{ROTULO_ESTADO_RUA[r.estado]}</span>
        {planejadoPara && <span className="planejado">→ {nomes.get(planejadoPara)} (plano)</span>}
        <button
          type="button"
          className={`tag-regiao ${r.regiao.status === 'desconhecida' ? 'a-definir' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            setMudarRegiao(!mudarRegiao);
          }}
          title="Região operacional (clique para definir/mudar)"
        >
          <span aria-hidden="true">◯</span> {regiaoTxt}
        </button>
      </div>
      <div className="corpo-tile">
        <input type="checkbox" checked={marcada} disabled={!selecionavel} onChange={onAlternar} aria-label={`Selecionar ${r.nome}`} />
        <span className="icone" aria-hidden="true"><IconeRua /></span>
        <div className="info">
          <b>{r.nome}</b>
          <span className="fraco">
            {r.total} pacote(s) · {r.destinos} destino(s)
            {r.disponiveis > 0 && r.disponiveis < r.total && ` · ${r.disponiveis} disponíveis`}
            {r.atribuidos > 0 && <> · com <b>{com}</b></>}
          </span>
          {r.revisao > 0 && <span className="alerta-txt">{r.revisao} em revisão</span>}
        </div>
        <span className="qtd grande-qtd">{r.disponiveis > 0 ? r.disponiveis : r.total}</span>
      </div>
      {(mudarRegiao || (r.regiao.status === 'desconhecida' && marcada)) && (
        <EscolhaRegiao r={r} regioes={regioes} onDefinir={(v) => { setMudarRegiao(false); onDefinirRegiao(v); }} />
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Destino: ajudante
// ---------------------------------------------------------------------------

function CardAjudante({ p, planejadas, projetado, selecionadas, onReceber, onTirarDoPlano, onSoltar }: {
  p: ResumoPerfil;
  planejadas: RuaNoOrquestrador[];
  projetado: number;
  selecionadas: number;
  onReceber: () => void;
  onTirarDoPlano: (chave: string) => void;
  onSoltar: (chave: string) => void;
}) {
  const [sobre, setSobre] = useState(false);
  const a = p.ajudante;
  const bloqueado = !a.ativo || p.carga?.situacao === 'EM_ROTA' || p.carga?.situacao === 'CONCLUIDA';
  const total = p.pacotes + projetado;
  const lotado = a.capacidade !== null && p.pacotes >= a.capacidade;
  const passa = a.capacidade !== null && total > a.capacidade;
  const motivo = !a.ativo ? 'inativo' : bloqueado ? 'em rota — finalize antes de receber ruas' : null;
  return (
    <div
      className={`card-ajudante ${planejadas.length ? 'com-plano' : ''} ${bloqueado ? 'travado' : ''} ${sobre ? 'drop-alvo' : ''}`}
      onDragOver={(e) => {
        if (bloqueado) return;
        e.preventDefault();
        setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSobre(false);
        if (!bloqueado) onSoltar(e.dataTransfer.getData('text/plain'));
      }}
    >
      <button
        type="button"
        className="area"
        disabled={bloqueado || selecionadas === 0}
        onClick={onReceber}
        aria-label={`Planejar ${selecionadas} rua(s) selecionada(s) para ${a.nome}`}
      >
        <span className="avatar" aria-hidden="true">{iniciais(a.nome)}</span>
        <span className="quem">
          <b>{a.nome}</b>
          <span className="fraco">
            {a.veiculo ?? 'veículo não informado'}
            {p.carga ? ` · ${ROTULO_SITUACAO_PERFIL[p.carga.situacao]} ${p.carga.codigo}` : ''}
          </span>
        </span>
        <span className="capacidade">
          <b className="qtd">
            {total}
            {a.capacidade ? `/${a.capacidade}` : ''}
          </b>
          <span className={lotado ? 'alerta-txt' : 'fraco'}>{lotado ? 'LOTADO' : 'CAPACIDADE'}</span>
        </span>
      </button>
      <BarraCapacidade atual={p.pacotes} projetado={projetado} capacidade={a.capacidade} />
      <div className="rodape-card">
        {projetado > 0 && (
          <span className={passa ? 'alerta-txt' : 'projecao-txt'}>
            +{projetado} projetado{passa ? ` — passa a capacidade em ${total - a.capacidade!}` : ''}
          </span>
        )}
        {motivo && <span className="fraco">{motivo}</span>}
        <a className="abrir" href={`#/ajudantes/${a.id}`}>perfil →</a>
      </div>
      {planejadas.length > 0 && (
        <ul className="plano-chips" aria-label={`Ruas planejadas para ${a.nome}`}>
          {planejadas.map((r) => (
            <li key={r.chave}>
              {r.nome} <span className="qtd">{r.disponiveis}</span>
              <button type="button" onClick={() => onTirarDoPlano(r.chave)} aria-label={`Tirar ${r.nome} do plano`}>✕</button>
            </li>
          ))}
        </ul>
      )}
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
  const [plano, setPlano] = useState<Map<string, string>>(new Map()); // ruaChave → ajudanteId
  const [busca, setBusca] = useState('');
  const [regiaoFiltro, setRegiaoFiltro] = useState('');
  const [soDisponiveis, setSoDisponiveis] = useState(true);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const ruas = dados.dados?.ruas ?? [];
  const perfis = dados.dados?.perfis ?? [];
  const regioes = dados.dados?.regioes ?? [];
  const nomes = useMemo(() => new Map(perfis.map((p) => [p.ajudante.id, p.ajudante.nome])), [perfis]);
  const porChave = useMemo(() => new Map(ruas.map((r) => [r.chave, r])), [ruas]);
  const termo = busca.trim().toLowerCase();

  const regiaoDe = (r: RuaNoOrquestrador) =>
    r.regiao.status === 'conhecida' ? r.regiao.id : r.regiao.status === 'sem_regiao' ? SEM_REGIAO : A_DEFINIR;
  const visiveis = ruas
    .filter((r) => !soDisponiveis || r.disponiveis > 0)
    .filter((r) => !regiaoFiltro || regiaoDe(r) === regiaoFiltro)
    .filter((r) => !termo || r.nome.toLowerCase().includes(termo) || (r.regiao.status === 'conhecida' && r.regiao.nome.toLowerCase().includes(termo)))
    .sort((a, b) => {
      const ra = a.regiao.status === 'desconhecida' ? 0 : a.regiao.status === 'conhecida' ? 1 : 2;
      const rb = b.regiao.status === 'desconhecida' ? 0 : b.regiao.status === 'conhecida' ? 1 : 2;
      const na = a.regiao.status === 'conhecida' ? a.regiao.nome : '';
      const nb = b.regiao.status === 'conhecida' ? b.regiao.nome : '';
      return ra - rb || na.localeCompare(nb, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR');
    });
  const perfisVisiveis = perfis.filter((p) => !termo || p.ajudante.nome.toLowerCase().includes(termo));

  const aguardando = ruas.filter((r) => r.disponiveis > 0 && !plano.has(r.chave)).length;
  const disponiveisAjud = perfis.filter((p) => p.ajudante.ativo && p.carga?.situacao !== 'EM_ROTA' && p.carga?.situacao !== 'CONCLUIDA').length;
  const planejadasDe = (id: string) => [...plano].filter(([, a]) => a === id).map(([k]) => porChave.get(k)).filter((r): r is RuaNoOrquestrador => !!r);
  const totalPlano = [...plano.keys()].reduce((n, k) => n + (porChave.get(k)?.disponiveis ?? 0), 0);
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

  /** Coloca ruas no plano de um ajudante (substitui plano anterior dessas ruas). Nada é gravado ainda. */
  const planejar = (chaves: string[], ajudanteId: string) => {
    const validas = chaves.filter((k) => (porChave.get(k)?.disponiveis ?? 0) > 0);
    if (validas.length === 0) return;
    const p = new Map(plano);
    validas.forEach((k) => p.set(k, ajudanteId));
    setPlano(p);
    setMarcadas(new Set());
    setMsg({ tipo: 'info', texto: `${validas.length} rua(s) no plano de ${nomes.get(ajudanteId)}. Confirme os repasses para gravar.` });
  };

  const tirarDoPlano = (chave: string) => {
    const p = new Map(plano);
    p.delete(chave);
    setPlano(p);
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

  async function confirmar() {
    const ator = exigir();
    if (!ator || plano.size === 0) return;
    const grupos = perfis
      .map((p) => ({ p, ruas: planejadasDe(p.ajudante.id) }))
      .filter((g) => g.ruas.length > 0);
    const resumo = grupos
      .map((g) => `${g.p.ajudante.nome}: ${g.ruas.map((r) => r.nome).join(', ')} (${g.ruas.reduce((n, r) => n + r.disponiveis, 0)} pacotes)`)
      .join('\n');
    if (!confirm(`Confirmar os repasses? Cada ajudante recebe as ruas inteiras numa carga MONTADA (a rota não é iniciada agora).\n\n${resumo}`)) return;
    setEnviando(true);
    try {
      const r = await api.confirmarRepasses(grupos.map((g) => ({ ajudanteId: g.p.ajudante.id, ruas: g.ruas.map((x) => x.chave) })), ator);
      setMsg({ tipo: 'ok', texto: `Repasses confirmados: ${r.cargas.map((c) => `${c.ajudante} → ${c.codigo} (${c.ruas} rua(s), ${c.pacotes} pacote(s))`).join(' · ')}.` });
      setPlano(new Map());
      dados.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Nada foi gravado: ${(e as Error).message}` });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="repasse">
      <div className="repasse-cabecalho">
        <div>
          <h1>Orquestrador de repasse</h1>
          <p className="fraco sem-margem">Selecione ruas e clique no ajudante (ou arraste a rua até ele). Depois confirme os repasses.</p>
        </div>
        <div className="acoes">
          <a href="#/importar" className={`chip chip-status ${statusLote.cls}`}>{statusLote.txt}</a>
          <button type="button" disabled={plano.size === 0 || enviando} onClick={() => setPlano(new Map())}>
            Limpar plano
          </button>
          <button type="button" className="primario" disabled={plano.size === 0 || enviando} onClick={confirmar}>
            Confirmar repasses{plano.size ? ` (${plano.size})` : ''}
          </button>
        </div>
      </div>

      <div className="repasse-busca">
        <input type="search" placeholder="Buscar rua, região ou ajudante…" value={busca} onChange={(e) => setBusca(e.target.value)} />
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
            <select value={regiaoFiltro} onChange={(e) => setRegiaoFiltro(e.target.value)} aria-label="Filtrar por região">
              <option value="">Todas as regiões</option>
              <option value={A_DEFINIR}>Região a definir</option>
              {regioes.map((g) => (
                <option key={g.id} value={g.id}>{g.nome}</option>
              ))}
              <option value={SEM_REGIAO}>Sem região</option>
            </select>
            <label className="check">
              <input type="checkbox" checked={soDisponiveis} onChange={(e) => setSoDisponiveis(e.target.checked)} /> só com pacotes disponíveis
            </label>
          </div>
          <div className="lista-cards">
            {visiveis.map((r) => (
              <TileRua
                key={r.chave}
                r={r}
                marcada={marcadas.has(r.chave)}
                planejadoPara={plano.get(r.chave) ?? null}
                nomes={nomes}
                regioes={regioes}
                onAlternar={() => alternar(r.chave)}
                onDefinirRegiao={(v) => definirRegiao(r, v)}
                onArrastar={() => !marcadas.has(r.chave) && setMarcadas(new Set([...marcadas, r.chave]))}
              />
            ))}
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
            <span className="selo-contagem">{disponiveisAjud} disponíveis</span>
          </div>
          {marcadas.size > 0 && <p className="dica">{marcadas.size} rua(s) selecionada(s): clique no ajudante que vai receber.</p>}
          <div className="lista-cards">
            {perfisVisiveis.map((p) => {
              const planejadas = planejadasDe(p.ajudante.id);
              return (
                <CardAjudante
                  key={p.ajudante.id}
                  p={p}
                  planejadas={planejadas}
                  projetado={planejadas.reduce((n, r) => n + r.disponiveis, 0)}
                  selecionadas={marcadas.size}
                  onReceber={() => planejar([...marcadas], p.ajudante.id)}
                  onTirarDoPlano={tirarDoPlano}
                  onSoltar={(chave) => planejar([...new Set([...marcadas, chave])], p.ajudante.id)}
                />
              );
            })}
            {dados.dados && perfis.length === 0 && (
              <p className="fraco centro">Nenhum ajudante. <a href="#/ajudantes">Cadastre um perfil</a>.</p>
            )}
          </div>
        </div>
      </div>

      {plano.size > 0 && (
        <div className="barra-acao fixa">
          <span>
            Plano: <b>{plano.size}</b> rua(s) · <b>{totalPlano}</b> pacote(s) ·{' '}
            {perfis
              .map((p) => ({ nome: p.ajudante.nome, n: planejadasDe(p.ajudante.id).length }))
              .filter((x) => x.n > 0)
              .map((x) => `${x.nome} (${x.n})`)
              .join(', ')}
          </span>
          <button type="button" className="primario" disabled={enviando} onClick={confirmar}>
            Confirmar repasses
          </button>
        </div>
      )}
    </section>
  );
}
