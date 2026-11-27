import {
  COMPETITOR_MAX,
  COMPETITOR_PLATFORMS,
  PLATFORM_LABELS,
  type Competitor,
  type CompetitorAnalysis,
  type CompetitorPlatform,
  type CompetitorPost,
} from '@prisma-app/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Icon } from '../../components/icons/Icon';
import { Page } from '../../components/Page/Page';
import { PlatformIcon } from '../../components/PlatformIcon/PlatformIcon';
import {
  useAddCompetitor,
  useAddCompetitorPost,
  useAnalyzeCompetitors,
  useCompetitors,
  useDeleteCompetitor,
  useDeleteCompetitorPost,
  useRefreshCompetitor,
} from '../../hooks/useCompetitors';
import { useNow } from '../../hooks/useNow';
import { errorMessage } from '../../services/api/client';
import {
  analysisRefs,
  comparisonGroups,
  emptyPostForm,
  HANDLE_PLACEHOLDER,
  manualFormats,
  percent,
  postInput,
  slotLabel,
  statsLines,
  type PostForm,
} from '../../services/competitors';
import { relativeDay } from '../../services/dates';
import { compactNumber } from '../../services/trends';
import { addDays, zonedParts } from '../../services/zoned-time';
import styles from './Competitors.module.css';

/** Concorrenti (fase 8b): profili seguiti, confronto con le proprie metriche, analisi dell'AI. */
export function CompetitorsScreen() {
  const state = useCompetitors();
  const analyze = useAnalyzeCompetitors();
  const data = state.data;
  const groups = comparisonGroups(data);
  const competitors = data?.competitors ?? [];

  return (
    <Page
      title="Concorrenti"
      subtitle="YouTube si legge da solo ogni giorno; LinkedIn, Instagram e TikTok si inseriscono a mano"
      actions={
        data && !data.analysisBlocked ? (
          <Button
            icon={<Icon name="sparkle" size={16} />}
            disabled={analyze.isPending}
            onClick={() => analyze.mutate()}
          >
            {analyze.isPending ? 'Analizzo i post migliori…' : 'Analizza con l’AI'}
          </Button>
        ) : null
      }
    >
      {competitors.length < COMPETITOR_MAX && <AddCompetitorPanel />}

      {(analyze.error ?? state.error) ? (
        <p role="alert" className={styles.error}>
          {errorMessage(analyze.error ?? state.error)}
        </p>
      ) : null}

      {data && competitors.length === 0 && (
        <section className={styles.empty} aria-label="Nessun concorrente">
          <p>
            Aggiungi un canale YouTube (si legge con l’account YouTube collegato) o un profilo di
            LinkedIn, Instagram o TikTok di cui inserirai a mano i post migliori.
          </p>
        </section>
      )}

      {groups.length > 0 && (
        <section className={styles.panel} aria-labelledby="h-confronto">
          <h2 id="h-confronto" className={styles.sectionTitle}>
            Confronto · ultimi 90 giorni
          </h2>
          {groups.map((group) => (
            <div key={group.platform} className={styles.compare}>
              <div className={styles.compareHead}>
                <PlatformIcon platform={group.platform} size={20} />
                <span className={styles.compareTitle}>{group.label}</span>
                {group.mixedBases && (
                  <span className={styles.meta}>
                    tassi su basi diverse (visualizzazioni e follower): non confrontabili
                  </span>
                )}
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Profilo</th>
                    <th scope="col">Post a sett.</th>
                    <th scope="col">Tasso mediano</th>
                    <th scope="col">Formato migliore</th>
                    <th scope="col">Fascia migliore</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r) => (
                    <tr key={r.key} className={r.isOwn ? styles.ownRow : undefined}>
                      <th scope="row">{r.name}</th>
                      <td className="mono">
                        {r.postsPerWeek === null ? '—' : r.postsPerWeek.toLocaleString('it-IT')}
                      </td>
                      <td className="mono">
                        {percent(r.rate)}
                        {r.basis && (
                          <span className={styles.basis}>
                            {r.basis === 'visualizzazioni' ? ' su visual.' : ' su follower'}
                          </span>
                        )}
                      </td>
                      <td>{r.bestFormat ?? '—'}</td>
                      <td className="mono">{r.bestSlot ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className={styles.meta}>
            Tasso = (like + commenti + condivisioni) / visualizzazioni del post, o / follower se le
            visualizzazioni mancano. «Tu» compare dove ci sono le tue metriche. Fasce in ora
            italiana con almeno 2 post.
          </p>
        </section>
      )}

      {data?.analysis ? (
        <AnalysisPanel analysis={data.analysis} competitors={competitors} />
      ) : data?.analysisBlocked && competitors.length > 0 ? (
        <p className={styles.notes}>
          Analisi dell’AI: {data.analysisBlocked}
          {data.analysisBlocked.startsWith('AI') && (
            <>
              {' '}
              · <Link to="/impostazioni">Apri le Impostazioni</Link>
            </>
          )}
        </p>
      ) : null}

      {competitors.length > 0 && (
        <section aria-label="Concorrenti" className={styles.grid}>
          {competitors.map((c) => (
            <CompetitorCard key={c.id} competitor={c} />
          ))}
        </section>
      )}
    </Page>
  );
}

function AddCompetitorPanel() {
  const add = useAddCompetitor();
  const [platform, setPlatform] = useState<CompetitorPlatform>('youtube');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate(
      { name: name.trim(), platform, handle: handle.trim() },
      {
        onSuccess: () => {
          setName('');
          setHandle('');
        },
      },
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="h-aggiungi">
      <h2 id="h-aggiungi" className={styles.sectionTitle}>
        Aggiungi un concorrente
      </h2>
      <form className={styles.addForm} onSubmit={submit}>
        <label className={styles.field}>
          <span className={styles.label}>Piattaforma</span>
          <select
            className={styles.input}
            value={platform}
            onChange={(e) => setPlatform(e.target.value as CompetitorPlatform)}
          >
            {COMPETITOR_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Nome</span>
          <input
            className={styles.input}
            value={name}
            maxLength={80}
            placeholder="es. Marta Rossi"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{platform === 'youtube' ? 'Canale' : 'Profilo'}</span>
          <input
            className={styles.input}
            value={handle}
            maxLength={120}
            placeholder={HANDLE_PLACEHOLDER[platform]}
            onChange={(e) => setHandle(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={!name.trim() || !handle.trim() || add.isPending}>
          {add.isPending ? 'Aggiungo…' : 'Aggiungi'}
        </Button>
      </form>
      <p className={styles.meta}>
        {platform === 'youtube'
          ? 'Prisma legge iscritti e ultimi 50 video con le statistiche pubbliche (3 unità di quota al giorno).'
          : `${PLATFORM_LABELS[platform]} non dà i post di altri profili alle app: aggiungi a mano link, testo e numeri dei post che vuoi studiare.`}
      </p>
      {add.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(add.error)}
        </p>
      ) : null}
    </section>
  );
}

function AnalysisPanel({
  analysis,
  competitors,
}: {
  analysis: CompetitorAnalysis;
  competitors: Competitor[];
}) {
  const refs = analysisRefs(analysis, competitors);
  const links = (ids: number[]) =>
    ids
      .map((id) => ({ id, ref: refs.get(id) }))
      .filter((x) => x.ref)
      .map(({ id, ref }) => (
        <a key={id} href={ref!.url} target="_blank" rel="noreferrer" className={styles.ref}>
          {ref!.competitor}: {ref!.title}
        </a>
      ));
  const when = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(analysis.createdAt));

  return (
    <section className={styles.panel} aria-labelledby="h-analisi">
      <div className={styles.panelHead}>
        <h2 id="h-analisi" className={styles.sectionTitle}>
          Cosa funziona
        </h2>
        <span className={`${styles.meta} mono`}>
          {analysis.model.split(':')[0]} · {analysis.basedOn} post · {when}
        </span>
      </div>
      <p className={styles.summary}>{analysis.summary}</p>
      <div className={styles.analysisGrid}>
        <div>
          <h3 className={styles.subTitle}>Aperture</h3>
          <ul className={styles.list}>
            {analysis.hooks.map((hook) => (
              <li key={hook.pattern}>
                {hook.pattern}
                <span className={styles.refs}>{links(hook.postIds)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={styles.subTitle}>Argomenti</h3>
          <ul className={styles.list}>
            {analysis.topics.map((topic) => (
              <li key={topic.topic}>
                {topic.topic}
                <span className={styles.refs}>{links(topic.postIds)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={styles.subTitle}>Struttura e lunghezza</h3>
          <p className={styles.text}>{analysis.structure}</p>
          <p className={styles.text}>{analysis.length}</p>
        </div>
        <div>
          <h3 className={styles.subTitle}>Da ripetere, con la tua voce</h3>
          <ul className={styles.list}>
            {analysis.repeat.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {analysis.avoid.length > 0 && (
            <>
              <h3 className={styles.subTitle}>Da evitare</h3>
              <ul className={styles.list}>
                {analysis.avoid.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function postNumbers(post: CompetitorPost): string {
  return [
    post.views !== null ? `${compactNumber(post.views)} visual.` : null,
    post.likes !== null ? `${compactNumber(post.likes)} like` : null,
    post.comments !== null ? `${compactNumber(post.comments)} commenti` : null,
    post.shares !== null ? `${compactNumber(post.shares)} condivisioni` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function CompetitorCard({ competitor: c }: { competitor: Competitor }) {
  const remove = useDeleteCompetitor();
  const refresh = useRefreshCompetitor();
  const removePost = useDeleteCompetitorPost();
  const now = useNow(60_000);
  const [adding, setAdding] = useState(false);
  const byId = new Map(c.posts.map((p) => [p.id, p]));
  const manual = c.posts.filter((p) => p.source === 'manuale');
  const error = remove.error ?? refresh.error ?? removePost.error;

  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <PlatformIcon platform={c.platform} size={28} />
        <div className={styles.cardName}>
          <h3 className={styles.cardTitle}>{c.name}</h3>
          {c.url ? (
            <a href={c.url} target="_blank" rel="noreferrer" className={styles.handle}>
              {c.handle}
            </a>
          ) : (
            <span className={styles.handle}>{c.handle}</span>
          )}
        </div>
        <div className={styles.cardActions}>
          {c.platform === 'youtube' && (
            <button
              type="button"
              className={styles.small}
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(c.id)}
            >
              {refresh.isPending ? 'Leggo…' : 'Aggiorna'}
            </button>
          )}
          <button
            type="button"
            className={styles.small}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Togliere ${c.name} e i suoi post salvati?`)) remove.mutate(c.id);
            }}
          >
            Togli
          </button>
        </div>
      </header>
      {c.lastError && <p className={styles.warning}>{c.lastError}</p>}
      <ul className={styles.stats}>
        {statsLines(c.stats, c.platform).map((line) => (
          <li key={line}>{line}</li>
        ))}
        {c.lastFetchedAt && <li>letto {relativeDay(c.lastFetchedAt, now)}</li>}
      </ul>
      {(c.stats.formats.length > 0 || c.stats.slots.length > 0) && (
        <div className={styles.chips}>
          {c.stats.formats.map((f) => (
            <span key={f.format} className={styles.chip} title={`${f.posts} post`}>
              {f.format} ·{' '}
              {f.medianRate !== null
                ? percent(f.medianRate)
                : `${compactNumber(f.medianInteractions)} int.`}
            </span>
          ))}
          {c.stats.slots.map((s) => (
            <span key={`${s.weekday}-${s.hour}`} className={`${styles.chip} mono`}>
              {slotLabel(s)} · {s.posts} post
            </span>
          ))}
        </div>
      )}
      {c.stats.top.length > 0 && (
        <ol className={styles.items}>
          {c.stats.top.map((top) => {
            const post = top.postId ? byId.get(top.postId) : undefined;
            return (
              <li key={top.postId ?? top.title} className={styles.item}>
                <span className={`${styles.rate} mono`}>
                  {top.rate !== null
                    ? percent(top.rate)
                    : `${compactNumber(top.interactions)} int.`}
                </span>
                <a
                  href={top.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.itemLink}
                >
                  {top.title || 'Post'}
                </a>
                <span className={`${styles.signals} mono`}>
                  {top.format} · {relativeDay(top.publishedAt, now)}
                  {post ? ` · ${postNumbers(post)}` : ''}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {manual.length > 0 && (
        <details className={styles.manual}>
          <summary>Post inseriti a mano ({manual.length})</summary>
          <ul className={styles.manualList}>
            {manual.map((p) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noreferrer" className={styles.itemLink}>
                  {p.title ?? p.text?.slice(0, 80)}
                </a>
                <button
                  type="button"
                  aria-label="Togli il post"
                  className={styles.remove}
                  disabled={removePost.isPending}
                  onClick={() => removePost.mutate(p.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {adding ? (
        <PostFormView competitor={c} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className={styles.action} onClick={() => setAdding(true)}>
          + Aggiungi un post
        </button>
      )}
      {error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(error)}
        </p>
      ) : null}
    </article>
  );
}

function PostFormView({ competitor, onDone }: { competitor: Competitor; onDone: () => void }) {
  const add = useAddCompetitorPost();
  const now = useNow(60_000);
  const [form, setForm] = useState<PostForm>(() =>
    emptyPostForm(competitor.platform, addDays(zonedParts(now).day, -1)),
  );
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof PostForm) => (value: string) => setForm({ ...form, [key]: value });

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = postInput(form);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    add.mutate({ id: competitor.id, input: result.input }, { onSuccess: onDone });
  }

  const numberField = (key: keyof PostForm, label: string) => (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        inputMode="numeric"
        value={form[key]}
        placeholder="—"
        onChange={(e) => set(key)(e.target.value)}
      />
    </label>
  );

  return (
    <form className={styles.postForm} onSubmit={submit} aria-label="Nuovo post del concorrente">
      <label className={styles.field}>
        <span className={styles.label}>Link al post</span>
        <input
          className={styles.input}
          value={form.url}
          placeholder="https://…"
          onChange={(e) => set('url')(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Titolo o prima riga</span>
        <input
          className={styles.input}
          value={form.title}
          maxLength={200}
          onChange={(e) => set('title')(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Testo (facoltativo, aiuta l’analisi)</span>
        <textarea
          className={styles.textarea}
          value={form.text}
          maxLength={3000}
          rows={3}
          onChange={(e) => set('text')(e.target.value)}
        />
      </label>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Giorno</span>
          <input
            type="date"
            className={styles.input}
            value={form.day}
            onChange={(e) => set('day')(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Ora</span>
          <input
            type="time"
            className={styles.input}
            value={form.time}
            onChange={(e) => set('time')(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Formato</span>
          <select
            className={styles.input}
            value={form.format}
            onChange={(e) => set('format')(e.target.value)}
          >
            {manualFormats(competitor.platform).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.row}>
        {numberField('likes', competitor.platform === 'linkedin' ? 'Reazioni' : 'Like')}
        {numberField('comments', 'Commenti')}
        {numberField('shares', competitor.platform === 'linkedin' ? 'Diffusioni' : 'Condivisioni')}
        {numberField('views', 'Visualizzazioni')}
        {numberField('followers', 'Follower')}
      </div>
      <p className={styles.meta}>
        Lascia vuoti i numeri che non vedi: restano «non noti», mai zero.
      </p>
      <div className={styles.row}>
        <Button type="submit" size={32} disabled={add.isPending}>
          {add.isPending ? 'Salvo…' : 'Salva il post'}
        </Button>
        <Button type="button" variant="secondary" size={32} onClick={onDone}>
          Annulla
        </Button>
      </div>
      {(error ?? add.error) ? (
        <p role="alert" className={styles.error}>
          {error ?? errorMessage(add.error)}
        </p>
      ) : null}
    </form>
  );
}
