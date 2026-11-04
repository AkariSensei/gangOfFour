import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type TripotSave, newSave, rentOf, upgradeSave } from './tripot';

/** Les parties du Tripot de tous les joueurs, gardées dans un fichier JSON (ou en mémoire sans fichier). */
export class TripotStore {
  private saves: Record<string, TripotSave> = {};
  private timer: NodeJS.Timeout | undefined;

  constructor(private file?: string) {
    if (!file) return;
    try {
      this.saves = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.saves = {};
    }
  }

  /** La partie d'un joueur, créée à sa première visite (une partie d'avant la refonte repart de zéro). */
  get(account: string, now = Date.now()): TripotSave {
    const save = this.saves[account];
    if (save?.v === 2) return upgradeSave(save);
    return (this.saves[account] = newSave(now));
  }

  /** Expérience versée à un joueur par la rente du Tripot (0 s'il n'y a jamais joué). */
  rentOf(account: string): number {
    const save = this.saves[account];
    return save?.v === 2 ? rentOf(save) : 0;
  }

  /** Enregistre bientôt (plusieurs changements rapprochés ne donnent qu'une écriture). */
  save(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.saveNow(), 1000);
  }

  saveNow(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.saves));
      renameSync(tmp, this.file);
    } catch (error) {
      console.error("Impossible d'enregistrer le tripot :", error);
    }
  }
}
