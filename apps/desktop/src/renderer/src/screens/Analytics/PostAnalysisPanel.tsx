import { PLATFORM_LABELS, POST_ANALYSIS_WINDOW_DAYS } from '@prisma-app/shared';
import { useState } from 'react';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import { useAnalyzePosts, usePostAnalysis } from '../../hooks/useAnalytics';
import { errorMessage } from '../../services/api/client';
import {
  aiSubtitle,
  conclusionRows,
  dimensionBlocks,
  platformSubtitle,
  postRows,
} from '../../services/post-analysis';
import shared from './Analytics.module.css';
import styles from './PostAnalysis.module.css';

/**
 * «Cosa funziona nei tuoi post» (fase 8d): gruppi per argomento, formato, apertura, lunghezza,
 * giorno e fascia oraria; un clic su un gruppo mostra i suoi post. L'AI classifica le aperture e
 * scrive le conclusioni, solo su richiesta.
 */
export function PostAnalysisPanel() {
  const query = usePostAnalysis();
  const analyze = useAnalyzePosts();
  const analysis = analyze.data ?? query.data;
  const [chosen, setChosen] = useState<string | null>(null);
  const [group, setGroup] = useState<{ title: string; ids: number[] } | null>(null);

  const platforms = analysis?.platforms ?? [];
  const current = platforms.find((p) => p.platform === chosen) ?? platforms[0];
  const conclusions = conclusionRows(analysis);
  const blocked = analysis?.aiBlocked ?? null;

  return (
    <section aria-labelledby="h-posts" className={styles.panel}>
      <div className={styles.head}>
        <h2 id="h-posts" className={shared.sectionTitle}>
          Cosa funziona nei tuoi post
        </h2>
        <span className={`${shared.aiMeta} mono`}>ultimi {POST_ANALYSIS_WINDOW_DAYS} giorni</span>
        {analysis && (
          <button
            type="button"
            className={`${shared.linkButton} ${styles.analyze}`}
            disabled={Boolean(blocked) || analyze.isPending}
            title={blocked ?? undefined}
            onClick={() => analyze.mutate()}
          >
            {analyze.isPending ? 'Analizzo…' : analysis.ai ? 'Rianalizza' : "Analizza con l'AI"}
          </button>
        )}
      </div>

      {(query.error ?? analyze.error) ? (
        <p role="alert" className={shared.error}>
          {errorMessage(query.error ?? analyze.error)}
        </p>
      ) : null}

      {analysis && platforms.length === 0 && (
        <p className={shared.empty}>
          Nessun post pubblicato negli ultimi {POST_ANALYSIS_WINDOW_DAYS} giorni: l&apos;analisi
          parte dal primo post con metriche.
        </p>
      )}

      {conclusions.length > 0 && (
        <div className={styles.conclusions}>
          <span className={`${shared.tipKind} mono`}>CONCLUSIONI DELL&apos;AI</span>
          <span className={`${shared.aiMeta} mono`}>{aiSubtitle(analysis)}</span>
          <ul className={styles.conclusionList}>
            {conclusions.map((c, i) => (
              <li key={i}>
                <p className={shared.tipText}>{c.text}</p>
                {c.posts.length > 0 && (
                  <span className={styles.cited}>
                    {c.posts.map((post) =>
                      post.url ? (
                        <a key={post.id} href={post.url} target="_blank" rel="noreferrer">
                          {post.title}
                        </a>
                      ) : (
                        <span key={post.id}>{post.title}</span>
                      ),
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {blocked && analysis && platforms.length > 0 && (
        <p className={styles.hint}>Analisi dell&apos;AI: {blocked}.</p>
      )}

      {current && (
        <>
          {platforms.length > 1 && (
            <div role="group" aria-label="Piattaforma" className={`${shared.tabs} ${styles.tabs}`}>
              {platforms.map((p) => (
                <button
                  key={p.platform}
                  type="button"
                  aria-pressed={p.platform === current.platform}
                  className={shared.tab}
                  onClick={() => {
                    setChosen(p.platform);
                    setGroup(null);
                  }}
                >
                  {PLATFORM_LABELS[p.platform]}
                </button>
              ))}
            </div>
          )}
          <div className={styles.subtitle}>
            <PlatformIcon platform={current.platform} size={20} />
            <span>{platformSubtitle(current)}</span>
          </div>

          <div className={styles.grid}>
            {dimensionBlocks(current).map((block) => (
              <div key={block.dimension} className={styles.block}>
                <h3 className={styles.blockTitle}>{block.title}</h3>
                {block.rows.map((row) => {
                  const title = `${block.title}: ${row.label}`;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      className={styles.row}
                      data-few={row.fewData || undefined}
                      aria-pressed={group?.title === title}
                      onClick={() =>
                        setGroup(group?.title === title ? null : { title, ids: row.publicationIds })
                      }
                    >
                      <span className={styles.rowLabel}>{row.label}</span>
                      <span className={`${styles.rowValue} mono`}>{row.value}</span>
                      <span className={styles.track} aria-hidden="true">
                        <span className={styles.fill} style={{ width: `${row.width}%` }} />
                      </span>
                      <span className={`${styles.rowCount} mono`}>{row.count}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <h3 className={styles.blockTitle}>{group ? `Post · ${group.title}` : 'Tutti i post'}</h3>
          <ul className={styles.posts}>
            {postRows(current, group?.ids).map((post) => (
              <li key={post.id} className={styles.post}>
                <div className={styles.postText}>
                  {post.url ? (
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.postTitle}
                    >
                      {post.title}
                    </a>
                  ) : (
                    <span className={styles.postTitle}>{post.title}</span>
                  )}
                  <span className={styles.postMeta}>{post.meta}</span>
                  {post.opening && <span className={styles.opening}>«{post.opening}»</span>}
                </div>
                <span className={`${styles.postValue} mono`}>{post.value}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
