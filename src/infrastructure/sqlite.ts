/**
 * Implementação SQLite do Armazém (usa o `node:sqlite` embutido no Node 24 — sem servidor,
 * sem compilação nativa). Trocar por Postgres no futuro = reescrever só este arquivo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type {
  Ajudante,
  Armazem,
  FiltroPacotes,
  ItemLote,
  Lote,
  RepositorioAjudantes,
  RepositorioCargas,
  RepositorioDestinos,
  RepositorioEventos,
  RepositorioLotes,
  RepositorioPacotes,
  StatusLote,
} from '../application/portas';
import type { Carga, EventoCarga } from '../domain/carga';
import type { Destino } from '../domain/destinoPacote';
import { chaveTexto } from '../domain/destino/texto';
import type { Evento } from '../domain/eventos';
import type { Pacote } from '../domain/pacote';

type Linha = Record<string, unknown>;
const json = (v: unknown) => JSON.stringify(v);
const parse = <T>(v: unknown): T => JSON.parse(String(v)) as T;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

const PASTA_MIGRACOES = fileURLToPath(new URL('./migrations/', import.meta.url));

export function abrirBanco(caminho: string): DatabaseSync {
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS migracoes (nome TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL)');
  const aplicadas = new Set(db.prepare('SELECT nome FROM migracoes').all().map((r) => String(r.nome)));
  for (const nome of readdirSync(PASTA_MIGRACOES).filter((f) => f.endsWith('.sql')).sort()) {
    if (aplicadas.has(nome)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(PASTA_MIGRACOES + nome, 'utf8'));
      db.prepare('INSERT INTO migracoes (nome, aplicada_em) VALUES (?, ?)').run(nome, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

// ---------------------------------------------------------------------------

function pacoteDaLinha(r: Linha): Pacote {
  return {
    id: String(r.id),
    transportadora: String(r.transportadora),
    codigo: String(r.codigo),
    dados: {
      destinatario: String(r.destinatario),
      rua: String(r.rua),
      ruaDetalhe: String(r.rua_detalhe),
      numero: String(r.numero),
      complemento: String(r.complemento),
      bairro: String(r.bairro),
      cidade: String(r.cidade),
      uf: String(r.uf),
      cep: String(r.cep),
    },
    destinoId: str(r.destino_id),
    destinoCandidatos: parse(r.destino_candidatos),
    estado: String(r.estado) as Pacote['estado'],
    responsavelId: str(r.responsavel_id),
    cargaId: str(r.carga_id),
    confirmacaoEntrega: r.confirmacao_entrega ? parse(r.confirmacao_entrega) : null,
    motivoInsucesso: str(r.motivo_insucesso),
    pendencias: parse(r.pendencias),
    origem: {
      loteId: String(r.origem_lote_id),
      arquivo: String(r.origem_arquivo),
      card: r.origem_card === null ? null : Number(r.origem_card),
    },
    criadoEm: String(r.criado_em),
    atualizadoEm: String(r.atualizado_em),
    versao: Number(r.versao),
  };
}

class Pacotes implements RepositorioPacotes {
  constructor(private db: DatabaseSync) {}

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM pacotes WHERE id = ?').get(id);
    return r ? pacoteDaLinha(r) : undefined;
  }

  porChave(transportadora: string, codigo: string) {
    const r = this.db.prepare('SELECT * FROM pacotes WHERE transportadora = ? AND codigo = ?').get(transportadora, codigo);
    return r ? pacoteDaLinha(r) : undefined;
  }

  listar(f: FiltroPacotes = {}) {
    const onde: string[] = [];
    const args: (string | number)[] = [];
    if (f.estado) (onde.push('estado = ?'), args.push(f.estado));
    if (f.responsavelId) (onde.push('responsavel_id = ?'), args.push(f.responsavelId));
    if (f.semResponsavel) onde.push('responsavel_id IS NULL');
    if (f.revisaoPendente) onde.push("pendencias <> '[]'");
    if (f.destinoId) (onde.push('destino_id = ?'), args.push(f.destinoId));
    const sql =
      `SELECT * FROM pacotes ${onde.length ? `WHERE ${onde.join(' AND ')}` : ''} ` +
      'ORDER BY rua COLLATE NOCASE, CAST(numero AS INTEGER), numero, complemento, codigo';
    let lista = this.db.prepare(sql).all(...args).map(pacoteDaLinha);
    if (f.busca) {
      // Busca sem acento/maiúscula, em código, destinatário, rua e complemento.
      const alvo = chaveTexto(f.busca);
      lista = lista.filter((p) =>
        [p.codigo, p.dados.destinatario, p.dados.rua, p.dados.complemento, p.dados.numero].some((c) =>
          chaveTexto(c).includes(alvo),
        ),
      );
    }
    return lista;
  }

  salvar(p: Pacote, versaoEsperada: number | null) {
    const valores = [
      p.transportadora, p.codigo, p.dados.destinatario, p.dados.rua, p.dados.ruaDetalhe, p.dados.numero,
      p.dados.complemento, p.dados.bairro, p.dados.cidade, p.dados.uf, p.dados.cep, p.destinoId,
      json(p.destinoCandidatos), p.estado, p.responsavelId, json(p.pendencias), p.origem.loteId,
      p.origem.arquivo, p.origem.card, p.criadoEm, p.atualizadoEm, p.versao, p.cargaId,
      p.confirmacaoEntrega ? json(p.confirmacaoEntrega) : null, p.motivoInsucesso,
    ];
    if (versaoEsperada === null) {
      this.db
        .prepare(
          `INSERT INTO pacotes (transportadora, codigo, destinatario, rua, rua_detalhe, numero, complemento, bairro,
            cidade, uf, cep, destino_id, destino_candidatos, estado, responsavel_id, pendencias, origem_lote_id,
            origem_arquivo, origem_card, criado_em, atualizado_em, versao, carga_id, confirmacao_entrega, motivo_insucesso, id)
           VALUES (${new Array(26).fill('?').join(',')})`,
        )
        .run(...valores, p.id);
      return;
    }
    const r = this.db
      .prepare(
        `UPDATE pacotes SET transportadora=?, codigo=?, destinatario=?, rua=?, rua_detalhe=?, numero=?, complemento=?,
          bairro=?, cidade=?, uf=?, cep=?, destino_id=?, destino_candidatos=?, estado=?, responsavel_id=?, pendencias=?,
          origem_lote_id=?, origem_arquivo=?, origem_card=?, criado_em=?, atualizado_em=?, versao=?, carga_id=?,
          confirmacao_entrega=?, motivo_insucesso=?
         WHERE id=? AND versao=?`,
      )
      .run(...valores, p.id, versaoEsperada);
    if (Number(r.changes) !== 1) throw new Error(`pacote ${p.codigo} foi alterado por outra operação; tente de novo`);
  }
}

function eventoDaLinha(r: Linha): Evento {
  return {
    id: String(r.id),
    pacoteId: String(r.pacote_id),
    tipo: String(r.tipo),
    dados: parse(r.dados),
    ator: String(r.ator),
    origem: String(r.origem),
    ocorridoEm: String(r.ocorrido_em),
    registradoEm: String(r.registrado_em),
    chaveIdempotencia: String(r.chave_idempotencia),
  } as Evento;
}

class Eventos implements RepositorioEventos {
  constructor(private db: DatabaseSync) {}

  anexar(e: Evento) {
    const existente = this.porChave(e.chaveIdempotencia);
    if (existente) return { gravado: false, evento: existente };
    this.db
      .prepare(
        `INSERT INTO eventos (id, pacote_id, tipo, dados, ator, origem, ocorrido_em, registrado_em, chave_idempotencia)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(e.id, e.pacoteId, e.tipo, json(e.dados), e.ator, e.origem, e.ocorridoEm, e.registradoEm, e.chaveIdempotencia);
    return { gravado: true, evento: e };
  }

  porChave(chave: string) {
    const r = this.db.prepare('SELECT * FROM eventos WHERE chave_idempotencia = ?').get(chave);
    return r ? eventoDaLinha(r) : undefined;
  }

  doPacote(pacoteId: string) {
    return this.db.prepare('SELECT * FROM eventos WHERE pacote_id = ? ORDER BY seq').all(pacoteId).map(eventoDaLinha);
  }
}

function destinoDaLinha(r: Linha): Destino {
  return {
    id: String(r.id),
    ruaNome: String(r.rua_nome),
    ruaChave: String(r.rua_chave),
    numeroNome: String(r.numero_nome),
    numeroChave: String(r.numero_chave),
    contextoChave: String(r.contexto_chave),
    contextoNome: str(r.contexto_nome),
    contextoTipo: str(r.contexto_tipo) as Destino['contextoTipo'],
  };
}

class Destinos implements RepositorioDestinos {
  constructor(private db: DatabaseSync) {}

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM destinos WHERE id = ?').get(id);
    return r ? destinoDaLinha(r) : undefined;
  }

  noNumero(ruaChave: string, numeroChave: string) {
    return this.db
      .prepare('SELECT * FROM destinos WHERE rua_chave = ? AND numero_chave = ? ORDER BY id')
      .all(ruaChave, numeroChave)
      .map(destinoDaLinha);
  }

  criar(d: Destino, criadoEm: string) {
    this.db
      .prepare(
        `INSERT INTO destinos (id, rua_nome, rua_chave, numero_nome, numero_chave, contexto_chave, contexto_nome, contexto_tipo, criado_em)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(d.id, d.ruaNome, d.ruaChave, d.numeroNome, d.numeroChave, d.contextoChave, d.contextoNome, d.contextoTipo, criadoEm);
  }
}

function loteDaLinha(r: Linha): Lote {
  return {
    id: String(r.id),
    arquivo: String(r.arquivo),
    sha256: String(r.sha256),
    schema: String(r.schema),
    transportadora: String(r.transportadora),
    extractor: { nome: String(r.extractor_nome), versao: String(r.extractor_versao) },
    geradoEm: String(r.gerado_em),
    recebidoEm: String(r.recebido_em),
    status: String(r.status) as StatusLote,
    confirmadoEm: str(r.confirmado_em),
    confirmadoPor: str(r.confirmado_por),
    documento: parse(r.documento),
  };
}

function itemDaLinha(r: Linha): ItemLote {
  return {
    loteId: String(r.lote_id),
    indice: Number(r.indice),
    codigo: String(r.codigo),
    classe: String(r.classe) as ItemLote['classe'],
    dados: parse(r.dados),
    origem: parse(r.origem),
    motivos: parse(r.motivos),
    diferencas: parse(r.diferencas),
    pacoteExistenteId: str(r.pacote_existente_id),
    decisao: str(r.decisao) as ItemLote['decisao'],
    pacoteId: str(r.pacote_id),
  };
}

class Lotes implements RepositorioLotes {
  constructor(private db: DatabaseSync) {}

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM lotes WHERE id = ?').get(id);
    return r ? loteDaLinha(r) : undefined;
  }

  porSha256(sha: string) {
    const r = this.db
      .prepare("SELECT * FROM lotes WHERE sha256 = ? ORDER BY (status = 'DESCARTADO'), recebido_em DESC LIMIT 1")
      .get(sha);
    return r ? loteDaLinha(r) : undefined;
  }

  listar() {
    return this.db.prepare('SELECT * FROM lotes ORDER BY recebido_em DESC').all().map(loteDaLinha);
  }

  criar(l: Lote, itens: ItemLote[]) {
    this.db
      .prepare(
        `INSERT INTO lotes (id, arquivo, sha256, schema, transportadora, extractor_nome, extractor_versao, gerado_em,
          recebido_em, status, confirmado_em, confirmado_por, documento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        l.id, l.arquivo, l.sha256, l.schema, l.transportadora, l.extractor.nome, l.extractor.versao, l.geradoEm,
        l.recebidoEm, l.status, l.confirmadoEm, l.confirmadoPor, json(l.documento),
      );
    for (const i of itens) this.atualizarItem(i);
  }

  itens(loteId: string) {
    return this.db.prepare('SELECT * FROM itens_lote WHERE lote_id = ? ORDER BY indice').all(loteId).map(itemDaLinha);
  }

  atualizarItem(i: ItemLote) {
    this.db
      .prepare(
        `INSERT INTO itens_lote (lote_id, indice, codigo, classe, dados, origem, motivos, diferencas, pacote_existente_id, decisao, pacote_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (lote_id, indice) DO UPDATE SET codigo=excluded.codigo, classe=excluded.classe, dados=excluded.dados,
           origem=excluded.origem, motivos=excluded.motivos, diferencas=excluded.diferencas,
           pacote_existente_id=excluded.pacote_existente_id, decisao=excluded.decisao, pacote_id=excluded.pacote_id`,
      )
      .run(
        i.loteId, i.indice, i.codigo, i.classe, json(i.dados), json(i.origem), json(i.motivos), json(i.diferencas),
        i.pacoteExistenteId, i.decisao, i.pacoteId,
      );
  }

  atualizarStatus(id: string, status: StatusLote, confirmadoEm: string | null, confirmadoPor: string | null) {
    this.db.prepare('UPDATE lotes SET status=?, confirmado_em=?, confirmado_por=? WHERE id=?').run(status, confirmadoEm, confirmadoPor, id);
  }
}

class Ajudantes implements RepositorioAjudantes {
  constructor(private db: DatabaseSync) {}

  private linha = (r: Linha): Ajudante => ({
    id: String(r.id),
    nome: String(r.nome),
    ativo: Number(r.ativo) === 1,
    criadoEm: String(r.criado_em),
  });

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM ajudantes WHERE id = ?').get(id);
    return r ? this.linha(r) : undefined;
  }

  listar() {
    return this.db.prepare('SELECT * FROM ajudantes ORDER BY nome COLLATE NOCASE').all().map(this.linha);
  }

  criar(a: Ajudante) {
    this.db.prepare('INSERT INTO ajudantes (id, nome, ativo, criado_em) VALUES (?,?,?,?)').run(a.id, a.nome, a.ativo ? 1 : 0, a.criadoEm);
  }
}

class Cargas implements RepositorioCargas {
  constructor(private db: DatabaseSync) {}

  private montar = (r: Linha): Carga => ({
    id: String(r.id),
    codigo: String(r.codigo),
    ajudante: { id: String(r.ajudante_id), nome: String(r.ajudante_nome) },
    pacoteIds: this.db
      .prepare('SELECT pacote_id FROM cargas_pacotes WHERE carga_id = ? ORDER BY ordem')
      .all(String(r.id))
      .map((x) => String(x.pacote_id)),
    criadaEm: String(r.criada_em),
    criadaPor: String(r.criada_por),
    rotaIniciadaEm: str(r.rota_iniciada_em),
    rotaIniciadaPor: str(r.rota_iniciada_por),
  });

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM cargas WHERE id = ?').get(id);
    return r ? this.montar(r) : undefined;
  }

  listar() {
    return this.db.prepare('SELECT * FROM cargas ORDER BY criada_em DESC, codigo DESC').all().map(this.montar);
  }

  contarPorPrefixo(prefixo: string) {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM cargas WHERE codigo LIKE ?').get(`${prefixo}%`);
    return Number(r?.n ?? 0);
  }

  criar(c: Carga) {
    this.db
      .prepare('INSERT INTO cargas (id, codigo, ajudante_id, ajudante_nome, criada_em, criada_por) VALUES (?,?,?,?,?,?)')
      .run(c.id, c.codigo, c.ajudante.id, c.ajudante.nome, c.criadaEm, c.criadaPor);
    const ins = this.db.prepare('INSERT INTO cargas_pacotes (carga_id, pacote_id, ordem) VALUES (?,?,?)');
    c.pacoteIds.forEach((p, i) => ins.run(c.id, p, i));
  }

  marcarRotaIniciada(id: string, em: string, por: string) {
    this.db.prepare('UPDATE cargas SET rota_iniciada_em = ?, rota_iniciada_por = ? WHERE id = ? AND rota_iniciada_em IS NULL').run(em, por, id);
  }

  anexarEvento(e: EventoCarga) {
    this.db
      .prepare('INSERT INTO eventos_carga (id, carga_id, tipo, dados, ator, ocorrido_em, registrado_em) VALUES (?,?,?,?,?,?,?)')
      .run(e.id, e.cargaId, e.tipo, json(e.dados), e.ator, e.ocorridoEm, e.registradoEm);
  }

  eventos(cargaId: string) {
    return this.db
      .prepare('SELECT * FROM eventos_carga WHERE carga_id = ? ORDER BY seq')
      .all(cargaId)
      .map(
        (r) =>
          ({
            id: String(r.id),
            cargaId: String(r.carga_id),
            tipo: String(r.tipo),
            dados: parse(r.dados),
            ator: String(r.ator),
            ocorridoEm: String(r.ocorrido_em),
            registradoEm: String(r.registrado_em),
          }) as EventoCarga,
      );
  }
}

export function criarArmazemSqlite(db: DatabaseSync): Armazem {
  let profundidade = 0;
  return {
    pacotes: new Pacotes(db),
    eventos: new Eventos(db),
    destinos: new Destinos(db),
    lotes: new Lotes(db),
    ajudantes: new Ajudantes(db),
    cargas: new Cargas(db),
    transacao<T>(fn: () => T): T {
      if (profundidade > 0) return fn(); // já dentro de uma transação
      db.exec('BEGIN IMMEDIATE');
      profundidade++;
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        profundidade--;
      }
    },
  };
}
