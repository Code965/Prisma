import { VideoProjectSchema, type VideoProject, type VideoSource } from '@prisma-app/shared';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/**
 * Stato locale del desktop in SQLite (`node:sqlite`, incluso in Electron: niente moduli nativi
 * da compilare). Per ora i progetti video: il file sorgente resta dov'è, qui c'è il percorso e
 * il progetto in JSON. Le migrazioni seguono `PRAGMA user_version`.
 */
const MIGRATIONS = [
  `CREATE TABLE video_projects (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     source_path TEXT NOT NULL,
     data TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
];

export class LocalStore {
  private readonly db: DatabaseSync;

  constructor(
    path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db = new DatabaseSync(path);
    this.migrate();
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[i]!);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  listProjects(): VideoProject[] {
    const rows = this.db
      .prepare('SELECT data FROM video_projects ORDER BY created_at DESC')
      .all() as Array<{ data: string }>;
    return rows.map((row) => VideoProjectSchema.parse(JSON.parse(row.data)));
  }

  getProject(id: string): VideoProject | null {
    const row = this.db.prepare('SELECT data FROM video_projects WHERE id = ?').get(id) as
      { data: string } | undefined;
    return row ? VideoProjectSchema.parse(JSON.parse(row.data)) : null;
  }

  createProject(
    source: VideoSource,
    title = source.fileName.replace(/\.[^.]+$/, ''),
    extra: Partial<Pick<VideoProject, 'transcript' | 'edit' | 'short' | 'generated'>> = {},
  ): VideoProject {
    const at = this.now().toISOString();
    const project = VideoProjectSchema.parse({
      id: randomUUID(),
      title: title.slice(0, 200) || 'Video',
      source,
      ...extra,
      createdAt: at,
      updatedAt: at,
    });
    this.db
      .prepare(
        'INSERT INTO video_projects (id, title, source_path, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(project.id, project.title, source.path, JSON.stringify(project), at, at);
    return project;
  }

  updateProject(project: VideoProject): void {
    const parsed = VideoProjectSchema.parse(project);
    this.db
      .prepare('UPDATE video_projects SET title = ?, data = ?, updated_at = ? WHERE id = ?')
      .run(parsed.title, JSON.stringify(parsed), parsed.updatedAt, parsed.id);
  }

  /** Toglie il progetto da Prisma; il file video sul disco non si tocca. */
  removeProject(id: string): void {
    this.db.prepare('DELETE FROM video_projects WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}
