import { Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

// Renderiza markdown das respostas do modelo (tabelas, negrito, listas).
// Sem bypassSecurityTrustHtml: o HTML gerado pelo marked passa por
// sanitização explícita (SecurityContext.HTML), que remove <script>,
// handlers inline e URLs javascript: antes de chegar no [innerHTML].
@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';
    const html = marked.parse(value, { async: false, gfm: true, breaks: true }) as string;
    return this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
  }
}
