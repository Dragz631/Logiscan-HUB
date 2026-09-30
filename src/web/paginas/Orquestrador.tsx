/**
 * ORQUESTRADOR DE REPASSE — Origem: UNIDADES (região, grupo ou rua) → Destino: ajudantes.
 *
 * Primeiro "quanto tem aqui?" (cards resumidos), depois "quais ruas estão dentro?" (Expandir).
 * Fluxo: selecionar card(s) → selecionar o ajudante → "Entregar N unidade(s) ao <ajudante>" → carga MONTADA
 * → INICIAR ROTA no próprio card do ajudante → o Street dele recebe sozinho.
 * A rua vai sempre INTEIRA. Sem capacidade/"lotado". Nenhuma regra de negócio aqui: a tela mostra e chama a API.
 */
import { useMemo, useState } from 'react';
import type { ResumoPerfil, UnidadeRepasse } from '../../application/orquestracao';
import { api } from '../api';
import { useOperador } from '../contexto';
import { dataHora, diaCurto, streetVisto } from '../formato';
import { RepassarRota } from './RepassarRota';
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

const iniciais = (nome: string) =>
  nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

// ---------------------------------------------------------------------------
// Origem: CAIXA (card resumido; as ruas de dentro só ao expandir)
// ---------------------------------------------------------------------------

export const rotuloCaixa = (u: { numero: string | null; nome: string }) => (u.numero ? `${u.numero} · ${u.nome}` : u.nome);

function resumoUnidade(u: UnidadeRepasse): string {
  const pac = `${u.total} pacote${u.total === 1 ? '' : 's'}`;
  if (u.tipo === 'grupo') return `${pac} · ${u.subcaixas.length} caixa${u.subcaixas.length === 1 ? '' : 's'} dentro`;
  return `${pac} · ${u.ruas.length} rua${u.ruas.length === 1 ? '' : 's'}`;
}

function CardUnidade({ u, marcadas, nomes, onAlternar, dentroDeMarcado = false }: {
  u: UnidadeRepasse;
  marcadas: Set<string>;
  nomes: Map<string, string>;
  onAlternar: (chave: string) => void;
  /** O grupo inteiro (Associações) está marcado: esta caixa já vai junto. */
  dentroDeMarcado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const inteira = marcadas.has(u.chave) || (dentroDeMarcado && u.disponiveis > 0);
  const algumaSub = u.tipo === 'grupo' && u.subcaixas.some((c) => marcadas.has(c.chave));
  const selecionavel = u.disponiveis > 0 && !dentroDeMarcado;
  const com = u.responsaveis.map((id) => nomes.get(id) ?? '?').join(', ');
  return (
    <div className={`card-unidade ${inteira ? 'marcada' : algumaSub ? 'parcial' : ''} ${selecionavel || dentroDeMarcado ? '' : 'travada'}`}>
      <label className="topo">
        <input type="checkbox" checked={inteira} disabled={!selecionavel} onChange={() => onAlternar(u.chave)} aria-label={`Selecionar ${u.nome}`} />
        <span className="info">
          <b>{rotuloCaixa(u)}</b>
          <span className="fraco">
            {resumoUnidade(u)}
            {u.atribuidos > 0 && <> · {u.disponiveis > 0 ? `${u.atribuidos} já com` : 'com'} <b>{com}</b></>}
            {u.revisao > 0 && <span className="alerta-txt"> · {u.revisao} em revisão</span>}
            {u.retornados > 0 && (
              <span className="chip retornado" title="Voltaram para a caixa ao fim do dia: são de ontem, não de hoje">
                Retornado · do dia {u.diasRetornados.map(diaCurto).join(', ')} ({u.retornados})
              </span>
            )}
            {algumaSub && <span className="projecao-txt"> · {u.subcaixas.filter((c) => marcadas.has(c.chave)).length} caixa(s) escolhida(s)</span>}
          </span>
        </span>
        <span className="qtd grande-qtd" title={`${u.disponiveis} disponíveis de ${u.total}`}>{u.disponiveis > 0 ? u.disponiveis : u.total}</span>
      </label>
      <div className="acoes-unidade">
        <button type="button" className="link-mini" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
          {aberto ? 'Recolher ▴' : u.tipo === 'grupo' ? 'Ver as caixas ▾' : 'Expandir ▾'}
        </button>
        {!selecionavel && !dentroDeMarcado && u.total > 0 && <span className="fraco">sem pacotes disponíveis</span>}
      </div>
      {aberto && u.tipo === 'caixa' && (
        <ul className="logradouros">
          {u.ruas.map((r) => (
            <li key={r.chave}>
              {r.nome} — <b className="qtd">{r.total}</b>
              {r.atribuidos > 0 && <span className="fraco"> · {r.atribuidos} com {r.responsaveis.map((id) => nomes.get(id) ?? '?').join(', ')}</span>}
            </li>
          ))}
        </ul>
      )}
      {aberto && u.tipo === 'grupo' && (
        <div className="subcaixas">
          {u.subcaixas.map((c) => (
            <CardUnidade key={c.chave} u={c} marcadas={marcadas} nomes={nomes} onAlternar={onAlternar} dentroDeMarcado={marcadas.has(u.chave)} />
          ))}
        </div>
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
  if (p.carga?.situacao === 'EM_ROTA') return `Em rota com ${p.carga.codigo} desde ${dataHora(p.rotaIniciadaEm)} — carga fechada, não recebe novas caixas.`;
  if (p.carga?.situacao === 'CONCLUIDA') return `Rota concluída (${p.carga.codigo}) — finalize a carga no perfil (ou use o Novo dia) para receber novas caixas.`;
  return null;
}

function CardAjudante({ p, escolhido, aReceber, iniciando, onEscolher, onIniciarRota, onRepassar }: {
  p: ResumoPerfil;
  escolhido: boolean;
  aReceber: { unidades: number; pacotes: number };
  iniciando: boolean;
  onEscolher: () => void;
  onIniciarRota: () => void;
  onRepassar: () => void;
}) {
  const a = p.ajudante;
  const bloqueio = motivoBloqueio(p);
  const montada = p.carga?.situacao === 'MONTADA';
  return (
    <div className={`card-ajudante ${escolhido ? 'com-plano' : ''} ${bloqueio ? (a.ativo ? 'fechado' : 'travado') : ''}`}>
      <button type="button" className="area" disabled={!!bloqueio} onClick={onEscolher} aria-pressed={escolhido} aria-label={`Escolher ${a.nome}: ${p.pacotes} pacotes, ${p.caixas} caixa(s)`}>
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
          <b className="qtd">{p.caixas}</b> caixa{p.caixas === 1 ? '' : 's'}
        </span>
      </button>
      {p.pacotes > 0 && <BarraProgresso feitos={p.entregues + p.insucessos} total={p.pacotes} />}
      {bloqueio && (
        <p className="motivo" role="note">
          {bloqueio} {!a.ativo && <a href="#/ajudantes">Ir para Ajudantes →</a>}
        </p>
      )}
      {p.repasse && (
        <p className="repasse-aviso" role="status">
          ↔ {p.repasse.sentido === 'enviado'
            ? `Repasse do ${a.nome} para ${p.repasse.com}`
            : `Repasse do ${p.repasse.com} para ${a.nome}`} · {dataHora(p.repasse.em)} · {p.repasse.pacotes} pacote(s)
        </p>
      )}
      {p.carga?.situacao === 'EM_ROTA' && (
        <div className="acao-rota">
          <span className="chip perfil-EM_ROTA">EM ROTA</span>
          <button type="button" onClick={onRepassar} title="Se aconteceu algo com o ajudante: passa a rota para outro ajudante ativo">
            Repassar rota
          </button>
        </div>
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
        <span className={`street-visto ${p.streetVistoEm ? '' : 'nunca'}`}>{streetVisto(p.streetVistoEm)}</span>
        <a className="abrir" href={`#/ajudantes/${a.id}`}>perfil →</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

const casa = (termo: string, u: UnidadeRepasse): boolean =>
  !termo ||
  rotuloCaixa(u).toLowerCase().includes(termo) ||
  u.ruas.some((r) => r.nome.toLowerCase().includes(termo) || r.logradouros.some((l) => l.toLowerCase().includes(termo))) ||
  u.subcaixas.some((c) => casa(termo, c));

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
  const [repassando, setRepassando] = useState<ResumoPerfil | null>(null);

  const unidades = dados.dados?.unidades ?? [];
  const perfis = dados.dados?.perfis ?? [];
  const nomes = useMemo(() => new Map(perfis.map((p) => [p.ajudante.id, p.ajudante.nome])), [perfis]);
  const termo = busca.trim().toLowerCase();
  const visiveis = unidades.filter((u) => (!soDisponiveis || u.disponiveis > 0) && casa(termo, u));

  // O que está selecionado: caixas inteiras, ou o grupo (Associações) / sub-caixas dele — sem contar pacote duas vezes.
  const selecao = useMemo(() => {
    let pacotes = 0;
    const nomesSel: string[] = [];
    for (const u of unidades) {
      if (marcadas.has(u.chave)) {
        pacotes += u.disponiveis;
        nomesSel.push(u.nome);
        continue;
      }
      for (const c of u.subcaixas) if (marcadas.has(c.chave)) { pacotes += c.disponiveis; nomesSel.push(c.nome); }
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

  /** Marcar o grupo inteiro tira as sub-caixas avulsas dele (e vice-versa): nada entra duas vezes. */
  const alternar = (chave: string) => {
    const s = new Set(marcadas);
    const grupo = unidades.find((u) => u.chave === chave && u.tipo === 'grupo');
    if (s.has(chave)) s.delete(chave);
    else {
      s.add(chave);
      grupo?.subcaixas.forEach((c) => s.delete(c.chave));
      const dono = unidades.find((u) => u.subcaixas.some((c) => c.chave === chave));
      if (dono) s.delete(dono.chave);
    }
    setMarcadas(s);
  };

  async function entregar() {
    const ator = exigir();
    if (!ator || !perfilDestino || marcadas.size === 0) return;
    setEnviando(true);
    try {
      const r = await api.atribuirRuas(perfilDestino.ajudante.id, [...marcadas], ator);
      const fora = r.deFora.length
        ? ` Ficou de fora (uma caixa não fica com dois ajudantes): ${r.deFora.map((d) => `${d.rua} — ${d.pacotes} pacote(s) continua(m) no galpão, a caixa já está com ${d.com}`).join('; ')}.`
        : '';
      setMsg({
        tipo: r.deFora.length ? 'info' : 'ok',
        texto: `${r.ruas.length} caixa(s), ${r.pacotes} pacote(s) → ${perfilDestino.ajudante.nome} na carga ${r.carga.codigo} (MONTADA). Quando estiver pronto, clique em INICIAR ROTA no card dele.${fora}`,
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
    if (!confirm(`Confirmar início da rota de ${p.ajudante.nome}?\n\nCarga ${p.carga.codigo}: ${p.pacotes} pacote(s), ${p.caixas} caixa(s).\nDepois de iniciar, a carga fica FECHADA (não recebe nem perde caixas).`)) return;
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
          <a href="#/novo-dia" className="botao-sec" title="Fecha as cargas abertas e decide o que fazer com o que sobrou">Novo dia</a>
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
      {(dados.dados?.aguardandoRevisao.pacotes ?? 0) > 0 && (
        <Aviso tipo="info">
          <span className="aviso-revisao">
            <span>
              <b>{dados.dados!.aguardandoRevisao.pacotes} pacote(s)</b> de {dados.dados!.aguardandoRevisao.ruas} rua(s) esperando sua revisão: o HUB
              ainda não sabe a caixa deles, então eles não vão para ajudante.
            </span>
            <a href="#/triagem">Revisar na Triagem →</a>
          </span>
        </Aviso>
      )}

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
                onAlternar={alternar}
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
                onRepassar={() => setRepassando(p)}
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
      {repassando?.carga && (
        <RepassarRota
          cargaId={repassando.carga.id}
          de={repassando.ajudante.nome}
          onFechar={() => setRepassando(null)}
          onFeito={(texto) => {
            setRepassando(null);
            setDestino(null);
            setMsg({ tipo: 'ok', texto });
            dados.recarregar();
          }}
        />
      )}
    </section>
  );
}
