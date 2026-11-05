import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Réglages du site choisis par l'admin, gardés dans un petit fichier JSON (ou en mémoire sans fichier). */
export interface SiteState {
  /** Site fermé pour travaux : seul l'admin entre, les autres voient un message de maintenance. */
  maintenance: boolean;
}

export class SiteSettings {
  private state: SiteState;

  /** \`defaults\` : l'état de départ quand le fichier n'existe pas encore. */
  constructor(
    private file: string | undefined,
    defaults: SiteState,
  ) {
    this.state = { ...defaults };
    if (!file) return;
    try {
      this.state = { ...defaults, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch {
      // Pas encore de fichier : on part des réglages par défaut.
    }
  }

  get maintenance(): boolean {
    return this.state.maintenance;
  }

  setMaintenance(on: boolean): void {
    this.state.maintenance = on;
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }
}
