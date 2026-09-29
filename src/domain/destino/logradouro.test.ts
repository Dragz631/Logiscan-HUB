import { describe, expect, it } from 'vitest';
import { idLogradouro, mesmaRuaPorCep, nomeQuaseIgual, partesDoLogradouro, resolverLogradouro } from './logradouro';

describe('identidade do logradouro (street_id)', () => {
  it('ignora maiúsculas, acentos, espaços e pontuação', () => {
    expect(idLogradouro('RUA GENERAL GURJÃO')).toBe(idLogradouro('Rua General Gurjão'));
    expect(idLogradouro('PRAIA DO CAJU')).toBe(idLogradouro('praia do caju'));
    expect(idLogradouro('  Rua   Leão  XIII ')).toBe('rua leao xiii');
  });

  it('expande abreviações seguras', () => {
    expect(idLogradouro('R. Carlos Seidl')).toBe('rua carlos seidl');
    expect(idLogradouro('Av. Brasil')).toBe('avenida brasil');
    expect(idLogradouro('Tv. José Pinheiro')).toBe('travessa jose pinheiro');
    expect(idLogradouro('R. Gal. Gurjão')).toBe('rua general gurjao');
    expect(idLogradouro('Rua Mons. Manuel Gomes')).toBe('rua monsenhor manuel gomes');
    expect(idLogradouro('Rua N. Sra. da Penha')).toBe('rua nossa senhora da penha');
  });

  it('tipo abreviado só vale no início (não troca palavra do nome)', () => {
    expect(idLogradouro('Rua R')).toBe('rua r');
    expect(idLogradouro('Rua Al Mar')).toBe('rua al mar');
  });

  it('nunca junta nomes diferentes', () => {
    expect(idLogradouro('Rua Carlos Seidl')).not.toBe(idLogradouro('Rua Carlos Seixas'));
    expect(idLogradouro('Rua A')).not.toBe(idLogradouro('Travessa A'));
    expect(idLogradouro('Rua Monsenhor Manuel Gomes')).not.toBe(idLogradouro('Rua Monsenhor Manoel Gomes'));
  });

  it('separa tipo e nome', () => {
    expect(partesDoLogradouro('rua praia do caju')).toEqual({ tipo: 'rua', nucleo: 'praia do caju' });
    expect(partesDoLogradouro('praia do caju')).toEqual({ tipo: null, nucleo: 'praia do caju' });
    expect(partesDoLogradouro('rua')).toEqual({ tipo: null, nucleo: 'rua' });
  });
});

describe('resolverLogradouro (encaixar no que já existe)', () => {
  const cards = ['Rua Carlos Seidl', 'Rua Praia do Caju', 'Rua General Gurjão', 'Rua Monsenhor Manuel Gomes'];

  it('mesmo id → o card conhecido', () => {
    expect(resolverLogradouro('RUA GENERAL GURJÃO', cards)).toEqual({ como: 'igual', id: 'rua general gurjao', nome: 'Rua General Gurjão' });
  });

  it('sem tipo com UM conhecido de mesmo nome → encaixa', () => {
    expect(resolverLogradouro('PRAIA DO CAJU', cards)).toEqual({ como: 'sem_tipo', id: 'rua praia do caju', nome: 'Rua Praia do Caju' });
    expect(resolverLogradouro('Monsenhor Manuel Gomes', cards).nome).toBe('Rua Monsenhor Manuel Gomes');
  });

  it('a grafia sem tipo já estar na lista não impede o encaixe no único com tipo', () => {
    expect(resolverLogradouro('PRAIA DO CAJU', ['PRAIA DO CAJU', 'Rua Praia do Caju'])).toMatchObject({ como: 'sem_tipo', nome: 'Rua Praia do Caju' });
    expect(resolverLogradouro('A', ['A', 'Rua A', 'Travessa A'])).toMatchObject({ como: 'igual', id: 'a' });
  });

  it('sem tipo com dois conhecidos de mesmo nome → desconhecido (não escolhe)', () => {
    expect(resolverLogradouro('A', ['Rua A', 'Travessa A']).como).toBe('desconhecido');
  });

  it('com tipo nunca vira outro tipo', () => {
    expect(resolverLogradouro('Travessa A', ['Rua A']).como).toBe('desconhecido');
    expect(resolverLogradouro('Rua Praia do Caju', ['Praia do Caju']).como).toBe('desconhecido');
  });

  it('parecido não é igual', () => {
    expect(resolverLogradouro('Rua Carlos Seixas', cards)).toEqual({ como: 'desconhecido', id: 'rua carlos seixas', nome: 'Rua Carlos Seixas' });
  });
});

describe('CEP tira a dúvida de digitação (casos reais do lote de 29/09)', () => {
  it('mesmo CEP + nome quase igual = mesma rua', () => {
    expect(mesmaRuaPorCep({ nome: 'Rua Monsenhor Manuel Gomes', cep: '20931-670' }, { nome: 'Rua Monsenhor Manoel Gomes', cep: '20931670' })).toBe(true);
    expect(mesmaRuaPorCep({ nome: 'Rua Carlos Seidi', cep: '20931002' }, { nome: 'Rua Carlos Seidl', cep: '20931002' })).toBe(true);
    expect(mesmaRuaPorCep({ nome: 'Rua General Gurião', cep: '20931040' }, { nome: 'Rua General Gurjão', cep: '20931040' })).toBe(true);
    expect(mesmaRuaPorCep({ nome: 'Tavares de Guerra', cep: '20931330' }, { nome: 'Tavares Guerra', cep: '20931330' })).toBe(true);
    expect(mesmaRuaPorCep({ nome: 'Tavares de Guerra', cep: '20931330' }, { nome: 'Rua Tavares Guerra', cep: '20931330' })).toBe(true);
  });

  it('CEP sozinho não junta: no Caju um CEP cobre várias ruas', () => {
    expect(mesmaRuaPorCep({ nome: 'Rua E', cep: '20931030' }, { nome: 'Rua Leão XIII', cep: '20931030' })).toBe(false);
    expect(mesmaRuaPorCep({ nome: 'Rua Luiz Pimenta', cep: '20931004' }, { nome: 'Rua Carlos Seidl', cep: '20931004' })).toBe(false);
    expect(mesmaRuaPorCep({ nome: 'Rua A', cep: '20931025' }, { nome: 'Rua E', cep: '20931025' })).toBe(false);
  });

  it('nome parecido com CEP diferente continua outra rua (Seidl ≠ Seixas)', () => {
    expect(mesmaRuaPorCep({ nome: 'Rua Carlos Seixas', cep: '20931007' }, { nome: 'Rua Carlos Seidl', cep: '20931002' })).toBe(false);
    expect(nomeQuaseIgual('Rua Carlos Seixas', 'Rua Carlos Seidl')).toBe(false);
  });

  it('tipo diferente nunca é erro de digitação; sem CEP não decide', () => {
    expect(mesmaRuaPorCep({ nome: 'Travessa Miguel de Almeida', cep: '20931060' }, { nome: 'Rua Miguel de Almeida', cep: '20931060' })).toBe(false);
    expect(mesmaRuaPorCep({ nome: 'Rua Monsenhor Manuel Gomes', cep: '' }, { nome: 'Rua Monsenhor Manoel Gomes', cep: '' })).toBe(false);
  });
});
