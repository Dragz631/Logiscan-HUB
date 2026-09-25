/**
 * ORQUESTRADOR DE RUAS — selecionar rua(s) → escolher ajudante → atribuir.
 * Sem arrastar-e-soltar: a operação funciona só com seleção. Nenhuma regra aqui: a tela mostra e chama a API.
 */
import { useMemo, useState } from 'react';
import type { ResumoPerfil, RuaNoOrquestrador } from '../../application/orquestracao';
import type { Regiao } from '../../domain/regioes';
import { api } from '../api';
import { ir, useOperador } from '../contexto';
import { Aviso, useCarregar } from './comum';

export const ROTULO_ESTADO_RUA = { DISPONIVEL: 'Disponível', ATRIBUIDA: 'Atribuída', EM_ROTA: 'Em rota', CONCLUIDA: 'Concluída' } as const;
export const ROTULO_SITUACAO_PERFIL = { MONTADA: 'Carga montada', EM_ROTA: 'Em rota', CONCLUIDA: 'Rota concluída' } as const;

type Filtro = 'disponiveis' | 'todas';

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

function CardRua({ r, marcada, nomes, regioes, onAlternar, onDefinirRegiao }: {
  r: RuaNoOrquestrador;
  marcada: boolean;
  nomes: Map<string, string>;
  regioes: Regiao[];
  onAlternar: () => void;
  onDefinirRegiao: (valor: string) => void;
}) {
  const selecionavel = r.disponiveis > 0;
  const com = r.responsaveis.map((id) => nomes.get(id) ?? '?').join(', ');
  const [mudar, setMudar] = useState(false);
  return (
    <label className={`card-rua ${marcada ? 'marcada' : ''} ${selecionavel ? '' : 'travada'}`}>
      <input type="checkbox" checked={marcada} disabled={!selecionavel} onChange={onAlternar} />
      <div className="corpo">
        <div className="linha-topo">
          <b>{r.nome}</b>
          <span className="qtd">{r.total}</span>
        </div>
        <div className="detalhe">
          <span className={`chip rua-${r.estado}`}>{ROTULO_ESTADO_RUA[r.estado]}</span>
          {r.disponiveis > 0 && <span>{r.disponiveis} disponíveis</span>}
          {r.atribuidos > 0 && (
            <span>
              {r.atribuidos} atribuídos → <b>{com}</b>
            </span>
          )}
          {r.revisao > 0 && <span className="alerta-txt">{r.revisao} em revisão</span>}
          <span className="fraco">{r.destinos} destino(s)</span>
          {r.regiao.status !== 'desconhecida' && (
            <button type="button" className="link-mini" onClick={(e) => { e.preventDefault(); setMudar(!mudar); }}>
              {r.regiao.status === 'conhecida' ? r.regiao.nome : 'sem região'} ✎
            </button>
          )}
        </div>
        {(r.regiao.status === 'desconhecida' || mudar) && (
          <EscolhaRegiao r={r} regioes={regioes} onDefinir={(v) => { setMudar(false); onDefinirRegiao(v); }} />
        )}
      </div>
    </label>
  );
}

interface Grupo {
  chave: string;
  titulo: string;
  tipo: 'desconhecida' | 'regiao' | 'sem';
  ruas: RuaNoOrquestrador[];
}

/** Ruas agrupadas pelo mapa operacional: primeiro as que precisam de decisão, depois cada região, por fim "sem região". */
function agrupar(ruas: RuaNoOrquestrador[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const r of ruas) {
    const g =
      r.regiao.status === 'conhecida'
        ? { chave: r.regiao.id, titulo: r.regiao.nome, tipo: 'regiao' as const }
        : r.regiao.status === 'sem_regiao'
          ? { chave: SEM_REGIAO, titulo: 'Sem região', tipo: 'sem' as const }
          : { chave: '__revisao', titulo: 'Região a definir', tipo: 'desconhecida' as const };
    if (!grupos.has(g.chave)) grupos.set(g.chave, { ...g, ruas: [] });
    grupos.get(g.chave)!.ruas.push(r);
  }
  const ordem = { desconhecida: 0, regiao: 1, sem: 2 };
  return [...grupos.values()].sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || a.titulo.localeCompare(b.titulo, 'pt-BR'));
}

function CardPerfil({ p, escolhido, projetado, onEscolher }: { p: ResumoPerfil; escolhido: boolean; projetado: number; onEscolher: () => void }) {
  const a = p.ajudante;
  const bloqueado = !a.ativo || p.carga?.situacao === 'EM_ROTA' || p.carga?.situacao === 'CONCLUIDA';
  const total = p.pacotes + (escolhido ? projetado : 0);
  return (
    <div className={`card-perfil ${escolhido ? 'escolhido' : ''} ${bloqueado ? 'travado' : ''}`}>
      <button type="button" className="area" disabled={bloqueado} onClick={onEscolher} aria-pressed={escolhido}>
        <div className="linha-topo">
          <b>{a.nome}</b>
          <span className="qtd">
            {total}
            {a.capacidade ? `/${a.capacidade}` : ''}
          </span>
        </div>
        <div className="detalhe">
          {a.veiculo && <span>{a.veiculo}</span>}
          {p.carga ? (
            <span className={`chip perfil-${p.carga.situacao}`}>{ROTULO_SITUACAO_PERFIL[p.carga.situacao]}</span>
          ) : (
            <span className="chip">Livre</span>
          )}
          <span>{p.ruas} rua(s)</span>
          {!a.ativo && <span className="alerta-txt">inativo</span>}
        </div>
        <BarraCapacidade atual={p.pacotes} projetado={escolhido ? projetado : 0} capacidade={a.capacidade} />
        {escolhido && projetado > 0 && (
          <div className={a.capacidade && total > a.capacidade ? 'alerta-txt' : 'projecao-txt'}>
            +{projetado} projetado{a.capacidade && total > a.capacidade ? ` — passa a capacidade em ${total - a.capacidade}` : ''}
          </div>
        )}
        {bloqueado && a.ativo && <div className="fraco">em rota: finalize antes de receber novas ruas</div>}
      </button>
      <a className="abrir" href={`#/ajudantes/${a.id}`}>abrir perfil →</a>
    </div>
  );
}

export function Orquestrador() {
  const { exigir } = useOperador();
  const dados = useCarregar(() => api.orquestrador(), []);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('disponiveis');
  const [busca, setBusca] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const ruas = dados.dados?.ruas ?? [];
  const perfis = dados.dados?.perfis ?? [];
  const regioes = dados.dados?.regioes ?? [];
  const nomes = useMemo(() => new Map(perfis.map((p) => [p.ajudante.id, p.ajudante.nome])), [perfis]);
  const visiveis = ruas.filter(
    (r) => (filtro === 'todas' || r.disponiveis > 0) && (!busca || r.nome.toLowerCase().includes(busca.toLowerCase())),
  );
  const selecionadas = ruas.filter((r) => marcadas.has(r.chave));
  const projetado = selecionadas.reduce((n, r) => n + r.disponiveis, 0);
  const perfilDestino = perfis.find((p) => p.ajudante.id === destino);
  const aguardando = ruas.filter((r) => r.disponiveis > 0).length;

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
        const para = regiaoId ? (regioes.find((g) => g.id === regiaoId)?.nome ?? 'a nova região') : 'sem região';
        // conflito explícito: nada é sobrescrito sem confirmação
        if (!confirm(`${res.conflito.rua} já está em "${res.conflito.atual.nome}". Mudar para "${para}"? (fica registrado no histórico)`)) return;
        res = await api.definirRegiao(r.nome, regiaoId, ator, true);
      }
      setMsg({ tipo: 'ok', texto: `${r.nome}: região salva na memória do HUB. Da próxima vez, é automático.` });
      dados.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  async function atribuir() {
    const ator = exigir();
    if (!ator || !destino) return;
    setEnviando(true);
    try {
      const r = await api.atribuirRuas(destino, [...marcadas], ator);
      setMsg({ tipo: 'ok', texto: `${selecionadas.length} rua(s), ${r.pacotes} pacote(s) → ${perfilDestino?.ajudante.nome} na carga ${r.carga.codigo} (montada).` });
      setMarcadas(new Set());
      dados.recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section>
      <div className="cabecalho-pagina">
        <div>
          <h1>Orquestrador de ruas</h1>
          <p className="fraco">Selecione rua(s), escolha o ajudante e atribua. A rua vai inteira para a carga dele.</p>
        </div>
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {dados.erro && <Aviso>{dados.erro}</Aviso>}

      <div className="orquestrador">
        <div className="coluna">
          <div className="coluna-topo">
            <h2>Ruas</h2>
            <span className="chip">{aguardando} aguardando</span>
          </div>
          <div className="filtros">
            <input type="search" placeholder="Buscar rua…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
              <option value="disponiveis">Com pacotes disponíveis</option>
              <option value="todas">Todas as ruas da operação</option>
            </select>
          </div>
          <div className="lista-cards">
            {agrupar(visiveis).map((g) => {
              const selecionaveis = g.ruas.filter((r) => r.disponiveis > 0);
              const todasMarcadas = selecionaveis.length > 0 && selecionaveis.every((r) => marcadas.has(r.chave));
              return (
                <div key={g.chave} className={`grupo-regiao grupo-${g.tipo}`}>
                  <div className="grupo-topo">
                    <label>
                      <input
                        type="checkbox"
                        disabled={selecionaveis.length === 0}
                        checked={todasMarcadas}
                        onChange={() => {
                          const s = new Set(marcadas);
                          selecionaveis.forEach((r) => (todasMarcadas ? s.delete(r.chave) : s.add(r.chave)));
                          setMarcadas(s);
                        }}
                      />
                      <b>{g.titulo}</b>
                    </label>
                    <span className="fraco">
                      {g.ruas.length} rua(s) · {g.ruas.reduce((n, r) => n + r.disponiveis, 0)} disponíveis
                    </span>
                  </div>
                  {g.tipo === 'desconhecida' && (
                    <p className="fraco sem-margem">Ruas que o HUB ainda não conhece: diga a região uma vez e ele lembra.</p>
                  )}
                  {g.ruas.map((r) => (
                    <CardRua
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
                {ruas.length === 0 ? (
                  <>
                    Nenhum pacote na operação. <a href="#/importar">Importe um lote</a>.
                  </>
                ) : (
                  'Nenhuma rua com esse filtro.'
                )}
              </p>
            )}
          </div>
        </div>

        <div className="coluna">
          <div className="coluna-topo">
            <h2>Ajudantes</h2>
            <span className="chip">{perfis.filter((p) => p.ajudante.ativo && !p.carga).length} livres</span>
          </div>
          <div className="lista-cards">
            {perfis.map((p) => (
              <CardPerfil
                key={p.ajudante.id}
                p={p}
                escolhido={destino === p.ajudante.id}
                projetado={projetado}
                onEscolher={() => setDestino(destino === p.ajudante.id ? null : p.ajudante.id)}
              />
            ))}
            {dados.dados && perfis.length === 0 && (
              <p className="fraco centro">
                Nenhum ajudante. <a href="#/ajudantes">Cadastre um perfil</a>.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="barra-acao fixa">
        <span>
          <b>{selecionadas.length}</b> rua(s) · <b>{projetado}</b> pacote(s)
          {perfilDestino ? (
            <>
              {' '}→ <b>{perfilDestino.ajudante.nome}</b>
            </>
          ) : (
            <span className="fraco"> — escolha um ajudante</span>
          )}
        </span>
        <button type="button" className="primario" disabled={!destino || selecionadas.length === 0 || enviando} onClick={atribuir}>
          Atribuir
        </button>
        {perfilDestino?.carga && (
          <button type="button" onClick={() => ir(`/ajudantes/${perfilDestino.ajudante.id}`)}>
            Ver carga de {perfilDestino.ajudante.nome}
          </button>
        )}
      </div>
    </section>
  );
}
