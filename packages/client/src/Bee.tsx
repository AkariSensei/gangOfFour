import { useId } from 'react';
import happy from '../public/assets/brand/ludora-bee-happy.svg?raw';
import playing from '../public/assets/brand/ludora-bee-playing.svg?raw';
import sad from '../public/assets/brand/ludora-bee-sad.svg?raw';
import surprised from '../public/assets/brand/ludora-bee-surprised.svg?raw';
import thinking from '../public/assets/brand/ludora-bee-thinking.svg?raw';
import victory from '../public/assets/brand/ludora-bee-victory.svg?raw';

/** Les humeurs de l'abeille Ludora : les mêmes fichiers que dans public/assets/brand. */
const ART = { happy, playing, sad, surprised, thinking, victory };
export type BeeMood = keyof typeof ART;

/**
 * L'abeille Ludora, insérée telle quelle dans la page (et non en image) pour que ses ailes et ses yeux puissent
 * s'animer. Les identifiants de ses dégradés sont rendus uniques : plusieurs abeilles peuvent cohabiter.
 * `motion` : « idle » (elle flotte et cligne des yeux), « fly » (ailes qui battent), « hop » (petit saut de victoire).
 */
export function Bee({ mood = 'happy', motion, label, className = '' }: { mood?: BeeMood; motion?: 'idle' | 'fly' | 'hop'; label?: string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const svg = ART[mood].replace(/id="([^"]+)"/g, `id="$1-${uid}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${uid})`);
  return (
    <span
      className={`bee bee-${mood} ${motion ? `bee-${motion}` : ''} ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Attente (connexion, salon) : l'abeille vole d'une alvéole à l'autre, qui s'allument à son passage. */
export function HiveLoader({ text }: { text?: string }) {
  return (
    <div className="hive-loader" role="status">
      <div className="hive-loader-cells" aria-hidden>
        <span />
        <span />
        <span />
        <Bee motion="fly" className="hive-loader-bee" />
      </div>
      {text && <span className="hive-loader-text">{text}</span>}
    </div>
  );
}
