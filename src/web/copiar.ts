/**
 * Copia um texto para a área de transferência. Usa a API moderna e, se o navegador recusar (página sem
 * permissão, celular antigo), cai numa cópia por campo de texto escondido. Devolve se funcionou.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* segue para a cópia de reserva */
  }
  try {
    const campo = document.createElement('textarea');
    campo.value = texto;
    campo.setAttribute('readonly', '');
    campo.style.position = 'fixed';
    campo.style.opacity = '0';
    document.body.appendChild(campo);
    campo.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(campo);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Imprime um texto (relatório) sem mexer na tela: abre uma página escondida só com o texto e chama a impressão.
 * Funciona igual para qualquer relatório; o navegador deixa escolher a impressora ou "salvar em PDF".
 */
export function imprimirTexto(titulo: string, texto: string): void {
  const quadro = document.createElement('iframe');
  quadro.setAttribute('aria-hidden', 'true');
  quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(quadro);
  const doc = quadro.contentDocument;
  if (!doc || !quadro.contentWindow) {
    document.body.removeChild(quadro);
    return;
  }
  const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  doc.open();
  doc.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>` +
      '<style>body{font:12pt/1.45 system-ui,Segoe UI,sans-serif;margin:1.5cm;color:#000}pre{white-space:pre-wrap;font:inherit;margin:0}</style>' +
      `</head><body><pre>${escapar(texto.replace(/\*/g, ''))}</pre></body></html>`,
  );
  doc.close();
  const janela = quadro.contentWindow;
  window.setTimeout(() => {
    janela.focus();
    janela.print();
    window.setTimeout(() => quadro.parentNode?.removeChild(quadro), 1000);
  }, 100);
}
