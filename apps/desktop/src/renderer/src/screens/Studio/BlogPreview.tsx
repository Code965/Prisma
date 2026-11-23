import type { VariantMetadata } from '@prisma-app/shared';
import { createElement, type ReactNode, useMemo } from 'react';
import {
  type ArticleNode,
  articleDate,
  articleText,
  parseArticle,
  readingMinutes,
  readingTimeLabel,
} from '../../services/article-preview';
import styles from './BlogPreview.module.css';

interface BlogPreviewProps {
  body: string;
  metadata: VariantMetadata;
  author: string;
  date: Date;
}

/**
 * Anteprima dell'articolo in una pagina di lettura neutra (ogni blog ha la sua grafica): data,
 * tempo di lettura, titolo, autore, corpo e come apparirà nei motori di ricerca. Segue il tema
 * di Prisma. L'HTML passa da `parseArticle`, mai da innerHTML.
 */
export function BlogPreview({ body, metadata, author, date }: BlogPreviewProps) {
  const nodes = useMemo(() => parseArticle(body), [body]);
  const minutes = readingMinutes(articleText(nodes));

  return (
    <article className={styles.page}>
      <p className={styles.meta}>
        {articleDate(date)} · {readingTimeLabel(minutes)}
      </p>
      <h1 className={styles.title}>{metadata.title || 'Titolo dell’articolo'}</h1>
      <p className={styles.author}>{author}</p>
      <div className={styles.body}>
        {nodes.length > 0 ? renderNodes(nodes) : <p>Il testo dell’articolo apparirà qui.</p>}
      </div>
      {metadata.description && (
        <p className={styles.snippet}>
          <span className={styles.snippetLabel}>Nei motori di ricerca</span>
          {metadata.description}
        </p>
      )}
    </article>
  );
}

function renderNodes(nodes: ArticleNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.kind === 'text') return node.text;
    if (node.tag === 'a') {
      return createElement(
        'a',
        { key: index, href: node.href, target: '_blank', rel: 'noopener noreferrer' },
        renderNodes(node.children),
      );
    }
    if (node.tag === 'br' || node.tag === 'hr') return createElement(node.tag, { key: index });
    return createElement(node.tag, { key: index }, renderNodes(node.children));
  });
}
