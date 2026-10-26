import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Room } from './rooms';

/**
 * Les salons sont gardés en mémoire, mais recopiés dans un fichier à chaque changement : quand le site redémarre
 * (mise à jour, plantage), les parties en cours sont rechargées et les joueurs reprennent leur place automatiquement.
 */
export class SavedRooms {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly file: string | undefined,
    private readonly rooms: () => Room[],
    private readonly delayMs = 200,
  ) {}

  load(): Room[] {
    if (!this.file || !existsSync(this.file)) return [];
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      return Array.isArray(saved) ? saved : [];
    } catch (error) {
      console.error('Salons enregistrés illisibles, ignorés :', error);
      return [];
    }
  }

  /** Enregistre bientôt (plusieurs changements rapprochés ne donnent qu'une écriture). */
  schedule(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.saveNow(), this.delayMs);
  }

  saveNow(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.rooms()));
      renameSync(tmp, this.file);
    } catch (error) {
      console.error("Impossible d'enregistrer les salons :", error);
    }
  }
}
