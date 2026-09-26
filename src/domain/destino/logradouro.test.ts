import { describe, expect, it } from 'vitest';
import { idLogradouro, partesDoLogradouro, resolverLogradouro } from './logradouro';

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
