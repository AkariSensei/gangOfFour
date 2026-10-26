import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Au-delà, une même erreur n'est plus écrite pendant l'heure (pour qu'une erreur en boucle ne remplisse pas le disque). */
const MAX_SAME_ERROR_PER_HOUR = 20;

/**
 * Journal des erreurs du serveur : une ligne JSON par erreur dans `data/erreurs.jsonl`. La surveillance GitHub
 * (.github/workflows/surveillance.yml) relève ce fichier régulièrement et ouvre une issue s'il contient des erreurs.
 */
export class ErrorLog {
  private counts = new Map<string, number>();
  private hour = 0;

  constructor(private readonly file?: string) {}

  record(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[${context}]`, error);
    if (!this.file) return;

    const hour = Math.floor(Date.now() / 3_600_000);
    if (hour !== this.hour) {
      this.hour = hour;
      this.counts.clear();
    }
    const key = `${context}|${message}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    if (count > MAX_SAME_ERROR_PER_HOUR) return;

    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify({ at: new Date().toISOString(), context, message, stack })}\n`);
    } catch (writeError) {
      console.error("Impossible d'écrire le journal des erreurs :", writeError);
    }
  }
}
