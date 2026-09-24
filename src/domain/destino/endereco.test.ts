import { describe, expect, it } from 'vitest';
import { interpretarComplemento, interpretarEndereco, interpretarNumero, textoComplemento } from './endereco';

const end = (rua: string, numero: string, complemento = '') => interpretarEndereco({ rua, numero, complemento });

describe('interpretarEndereco — casos do pedido', () => {
  it('CASO 1: mesmo número, sem complemento → mesmo destino, sem inventar condomínio', () => {
    const a = end('Rua A', '100');
    const b = end('Rua A', '100');
    expect(a.destinoId).toBe(b.destinoId);
    expect(a.contexto).toBeUndefined();
    expect(a.unidade).toBeUndefined();
  });

  it('CASO 2: mesmo número, aptos diferentes → mesmo destino, unidades diferentes', () => {
    const a = end('Rua A', '100', 'Apto 101');
    const b = end('Rua A', '100', 'Apto 102');
    expect(a.destinoId).toBe(b.destinoId);
    expect(a.unidade?.chave).toBe('apto:101');
    expect(b.unidade?.chave).toBe('apto:102');
    expect(a.unidade?.chave).not.toBe(b.unidade?.chave);
  });

  it('CASO 3: mesmo número, Loja ABC vs Condomínio XYZ → destinos diferentes', () => {
    const loja = end('Rua A', '100', 'Loja ABC');
    const cond = end('Rua A', '100', 'Condomínio XYZ');
    expect(loja.destinoId).not.toBe(cond.destinoId);
    expect(loja.contexto).toMatchObject({ tipo: 'comercio', nome: 'Loja ABC' });
    expect(cond.contexto).toMatchObject({ tipo: 'condominio', nome: 'Condomínio XYZ' });
    expect(loja.numeroChave).toBe(cond.numeroChave);
  });

  it('CASO 4: números diferentes → destinos diferentes', () => {
    expect(end('Rua A', '100').destinoId).not.toBe(end('Rua A', '101').destinoId);
  });

  it('CASO 5: "Ap 101" é apartamento', () => {
    expect(end('Rua A', '100', 'Ap 101').unidade).toMatchObject({ tipo: 'apto', chave: 'apto:101', rotulo: 'Apto 101' });
  });

  it('CASO 6: "Apt 202" é apartamento', () => {
    expect(end('Rua A', '100', 'Apt 202').unidade).toMatchObject({ tipo: 'apto', chave: 'apto:202' });
  });

  it('CASO 7: "Bl 2" é bloco', () => {
    expect(end('Rua A', '100', 'Bl 2').unidade).toMatchObject({ tipo: 'bloco', chave: 'bloco:2', rotulo: 'Bloco 2' });
  });
});

describe('interpretarComplemento — reconhecimento explícito', () => {
  it.each([
    ['Apto 101', 'apto:101'],
    ['APTO 302', 'apto:302'],
    ['Apartamento 301', 'apto:301'],
    ['Ap. 101', 'apto:101'],
    ['AP101', 'apto:101'],
    ['Apt. 5', 'apto:5'],
    ['apto nº 12', 'apto:12'],
    ['Bloco 2', 'bloco:2'],
    ['Bloco B', 'bloco:b'],
    ['Bl. A', 'bloco:a'],
    ['Casa 2', 'casa:2'],
    ['Casa fundos', 'casa:fundos'],
    ['Casa de fundos', 'casa:fundos'],
    ['Casa Principal', 'casa:principal'],
    ['Portaria', 'portaria'],
    ['Térreo', 'terreo'],
    ['Fundos', 'fundos'],
    ['Sobrado', 'sobrado'],
    ['Cobertura', 'cobertura'],
    ['Sala 301', 'sala:301'],
    ['Loja 5', 'loja:5'],
    ['3º andar', 'andar:3'],
    ['Andar 3', 'andar:3'],
  ])('reconhece "%s" como unidade %s', (texto, chave) => {
    expect(interpretarComplemento(texto).unidade?.chave).toBe(chave);
  });

  it('combina bloco + apto em uma única unidade, independente da ordem', () => {
    const a = interpretarComplemento('Bl 2 Apto 101').unidade;
    const b = interpretarComplemento('Apto 101 Bloco 2').unidade;
    expect(a?.chave).toBe('bloco:2|apto:101');
    expect(b?.chave).toBe(a?.chave);
    expect(a?.rotulo).toBe('Bloco 2 · Apto 101');
  });

  it.each([
    ['Condomínio XYZ', 'condominio', 'Condomínio XYZ'],
    ['Cond. Sol', 'condominio', 'Condomínio Sol'],
    ['Condomínio Residencial X', 'condominio', 'Condomínio Residencial X'],
    ['Edifício Central', 'edificio', 'Edifício Central'],
    ['Ed. Central', 'edificio', 'Edifício Central'],
    ['Vila Esperança', 'vila', 'Vila Esperança'],
    ['Loja ABC', 'comercio', 'Loja ABC'],
    ['Padaria do Zé', 'comercio', 'Padaria do Zé'],
  ])('reconhece o local nomeado "%s"', (texto, tipo, nome) => {
    expect(interpretarComplemento(texto).contexto).toMatchObject({ tipo, nome });
  });

  it('Condomínio + unidade: separa contexto e unidade', () => {
    const r = interpretarComplemento('Condomínio Residencial X Apto 101');
    expect(r.contexto?.nome).toBe('Condomínio Residencial X');
    expect(r.unidade?.chave).toBe('apto:101');
  });

  it('"Ed. Central" e "Edifício Central" são o mesmo contexto', () => {
    expect(interpretarComplemento('Ed. Central').contexto?.chave).toBe(interpretarComplemento('Edifício Central').contexto?.chave);
  });

  it('acentos e caixa não mudam a chave', () => {
    expect(interpretarComplemento('TÉRREO').unidade?.chave).toBe('terreo');
    expect(interpretarComplemento('condominio xyz').contexto?.chave).toBe(interpretarComplemento('Condomínio XYZ').contexto?.chave);
  });
});

describe('interpretarComplemento — conservador: sem evidência, não inventa', () => {
  it.each([
    'Frente ao posto',
    'Próx. ao mercado',
    'Ao lado da igreja',
    'Salão de festas',
    'Casarão azul',
    'Portão verde',
    'Apple store',
    'Blindado',
    'Bloco Central',
    '101',
    'Casa',
    'Loja do João', // "Loja" + nome vira contexto (comércio), não unidade — ver teste abaixo
  ])('"%s" não gera unidade', (texto) => {
    expect(interpretarComplemento(texto).unidade).toBeUndefined();
  });

  it.each(['Frente ao posto', 'Próx. ao mercado', 'Ao lado da igreja', 'Salão de festas', 'Casarão azul', '101', 'Casa', 'Apple store'])(
    '"%s" também não gera contexto e é preservado como residual',
    (texto) => {
      const r = interpretarComplemento(texto);
      expect(r.contexto).toBeUndefined();
      expect(r.residual).toBe(texto);
    }
  );

  it('"Frente" sozinha é evidência; "Frente ao posto" não', () => {
    expect(interpretarComplemento('Frente').unidade?.chave).toBe('frente');
    expect(interpretarComplemento('Frente ao posto').unidade).toBeUndefined();
  });

  it('vazio → nada', () => {
    expect(interpretarComplemento('')).toMatchObject({ residual: '', evidencias: [] });
    expect(interpretarComplemento(undefined).unidade).toBeUndefined();
  });

  it('"Loja 5" é unidade; "Loja ABC" é contexto (destino) — nunca os dois', () => {
    expect(interpretarComplemento('Loja 5')).toMatchObject({ unidade: { chave: 'loja:5' }, contexto: undefined });
    expect(interpretarComplemento('Loja ABC')).toMatchObject({ unidade: undefined, contexto: { tipo: 'comercio' } });
  });
});

describe('interpretarNumero', () => {
  it.each([
    ['100', '100', '100'],
    ['Nº 100', '100', '100'],
    ['41A', '41a', '41A'],
    ['41 A', '41a', '41A'],
    ['41a', '41a', '41A'],
    ['41-A', '41a', '41A'],
    ['S/N', 'sn', 'S/N'],
    ['', 'sn', 'S/N'],
  ])('"%s" → chave %s', (bruto, chave, nome) => {
    expect(interpretarNumero(bruto)).toMatchObject({ chave, nome });
  });

  it('"41A", "41 A" e "41a" são o MESMO número', () => {
    const a = end('Rua X', '41A').destinoId;
    expect(end('Rua X', '41 A').destinoId).toBe(a);
    expect(end('Rua X', '41a').destinoId).toBe(a);
  });

  it('complemento colado no número é separado: "100 apto 101"', () => {
    const r = end('Rua A', '100 apto 101');
    expect(r.numeroChave).toBe('100');
    expect(r.unidade?.chave).toBe('apto:101');
  });

  it('não confunde a letra do complemento com sufixo do número', () => {
    expect(interpretarNumero('100 apto 101').chave).toBe('100');
  });
});

describe('rua', () => {
  it('ignora caixa, acento e espaços; mas NÃO funde tipos de via ("Rua A" ≠ "Travessa A")', () => {
    expect(end('  RUA   carlos seidl ', '1').ruaChave).toBe(end('Rua Carlos Seidl', '1').ruaChave);
    expect(end('Rua A', '1').destinoId).not.toBe(end('Travessa A', '1').destinoId);
    expect(end('Rua A', '1').destinoId).not.toBe(end('Rua Alfa', '1').destinoId);
  });

  it('mesmo número em ruas diferentes são destinos diferentes', () => {
    expect(end('Rua A', '100').destinoId).not.toBe(end('Rua B', '100').destinoId);
  });
});

describe('ida e volta: memória recria o mesmo endereço', () => {
  it('textoComplemento(contexto, unidade) reinterpreta para a mesma evidência', () => {
    const orig = interpretarComplemento('Condomínio Residencial X Apto 101');
    const texto = textoComplemento(orig.contexto?.nome, orig.unidade?.rotulo);
    const volta = interpretarComplemento(texto);
    expect(volta.contexto?.chave).toBe(orig.contexto?.chave);
    expect(volta.unidade?.chave).toBe(orig.unidade?.chave);

    const bloco = interpretarComplemento('Bloco 2 Apto 101');
    const t2 = textoComplemento(undefined, bloco.unidade?.rotulo);
    expect(interpretarComplemento(t2).unidade?.chave).toBe('bloco:2|apto:101');
  });
});
