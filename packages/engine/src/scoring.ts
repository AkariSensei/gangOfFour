/** Points de pénalité selon le nombre de cartes restant en main à la fin d'une manche. */
export function penaltyForCards(cardsLeft: number): number {
  if (cardsLeft <= 7) return cardsLeft;
  if (cardsLeft <= 10) return cardsLeft * 2;
  if (cardsLeft <= 13) return cardsLeft * 3;
  if (cardsLeft <= 15) return cardsLeft * 4;
  return cardsLeft * 5;
}
