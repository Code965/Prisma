import { SLIDE_SIZE } from '@prisma-app/templates';
import styles from './SlideFrame.module.css';

interface SlideFrameProps {
  /** Documento completo prodotto da `renderSlideHtml`. */
  html: string;
  /** Larghezza mostrata in px: la slide 1080×1350 viene scalata. */
  width: number;
  title: string;
}

/**
 * Slide disegnata in un iframe `srcdoc` scalato: è lo stesso HTML dell'export, quindi l'anteprima
 * coincide con il file finale. `sandbox` senza `allow-scripts` (gli script non girano comunque)
 * e con `allow-same-origin` per caricare i font dell'app.
 */
export function SlideFrame({ html, width, title }: SlideFrameProps) {
  const scale = width / SLIDE_SIZE.width;
  return (
    <div className={styles.box} style={{ width, height: SLIDE_SIZE.height * scale }}>
      <iframe
        title={title}
        sandbox="allow-same-origin"
        srcDoc={html}
        tabIndex={-1}
        className={styles.frame}
        style={{ width: SLIDE_SIZE.width, height: SLIDE_SIZE.height, transform: `scale(${scale})` }}
      />
    </div>
  );
}
