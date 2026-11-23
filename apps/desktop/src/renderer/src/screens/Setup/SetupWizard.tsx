import { DEFAULT_BRAND } from '@prisma-app/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { PrismaMark } from '../../components/PrismaMark/PrismaMark';
import { useBrand } from '../../hooks/brand';
import { useTags } from '../../hooks/useIdeas';
import { useSaveBrandSetup } from '../../hooks/useSetup';
import { errorMessage } from '../../services/api/client';
import { SETUP_STEPS, initialsFrom, normalizeTag, type SetupStepId } from '../../services/setup';
import { AccountsSection } from '../Impostazioni/AccountsSection';
import { AiSettingsSection } from '../Impostazioni/AiSettingsSection';
import styles from './Setup.module.css';

/**
 * Configurazione guidata del primo avvio: benvenuto, brand e argomenti, AI, account. Ogni passo
 * dopo il brand si può rimandare: tutto si ritrova nelle Impostazioni.
 */
export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<SetupStepId>('benvenuto');
  const index = SETUP_STEPS.findIndex((item) => item.id === step);
  const go = (offset: number) => setStep(SETUP_STEPS[index + offset]!.id);
  const navigate = useNavigate();

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div className={styles.card}>
        <header className={styles.header}>
          <span className={styles.mark}>
            <PrismaMark size={28} />
            <span className={styles.markName}>Prisma</span>
          </span>
          <ol className={styles.steps} aria-label="Passi">
            {SETUP_STEPS.map((item, position) => (
              <li
                key={item.id}
                aria-current={item.id === step ? 'step' : undefined}
                className={`${styles.step} ${position <= index ? styles.stepDone : ''}`}
              >
                {item.title}
              </li>
            ))}
          </ol>
          <button
            type="button"
            className={styles.skip}
            onClick={onDone}
            aria-label="Chiudi la configurazione"
          >
            Chiudi
          </button>
        </header>

        <div className={styles.body}>
          {step === 'benvenuto' && <Welcome />}
          {step === 'brand' && <BrandStep onSaved={() => go(1)} />}
          {step === 'ai' && (
            <StepIntro
              title="Chi scrive le bozze"
              text="Scegli il servizio AI. Ollama e LM Studio sono gratis e girano sul tuo PC; DeepSeek, OpenAI e OpenRouter usano la tua chiave. Puoi farlo anche dopo."
            >
              <AiSettingsSection />
            </StepIntro>
          )}
          {step === 'account' && (
            <StepIntro
              title="Dove pubblicare"
              text="Per ogni piattaforma crei la tua app sviluppatore (con «App» Prisma ti guida passo passo) e poi colleghi l’account. Puoi farlo anche dopo, da Impostazioni."
            >
              <AccountsSection />
            </StepIntro>
          )}
          {step === 'fine' && (
            <StepIntro
              title="Tutto pronto"
              text="Scrivi la tua prima idea: Prisma ne farà le bozze per ogni piattaforma, che rivedi e approvi tu. Niente viene pubblicato senza la tua approvazione."
            />
          )}
        </div>

        <footer className={styles.footer}>
          {step === 'benvenuto' ? (
            <button type="button" className={styles.skip} onClick={onDone}>
              Salta la configurazione
            </button>
          ) : (
            <Button variant="secondary" onClick={() => go(-1)}>
              Indietro
            </Button>
          )}
          {step === 'benvenuto' && <Button onClick={() => go(1)}>Iniziamo</Button>}
          {(step === 'ai' || step === 'account') && <Button onClick={() => go(1)}>Avanti</Button>}
          {step === 'fine' && (
            <Button
              onClick={() => {
                onDone();
                navigate('/idee');
              }}
            >
              Scrivi la prima idea
            </Button>
          )}
          {/* Il passo «brand» ha il suo pulsante: salva e poi va avanti. */}
        </footer>
      </div>
    </div>
  );
}

function StepIntro(props: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <>
      <h1 id="setup-title" className={styles.title}>
        {props.title}
      </h1>
      <p className={styles.lead}>{props.text}</p>
      {props.children && <div className={styles.embedded}>{props.children}</div>}
    </>
  );
}

function Welcome() {
  return (
    <div className={styles.welcome}>
      <PrismaMark size={72} />
      <h1 id="setup-title" className={styles.welcomeTitle}>
        Benvenuto in Prisma
      </h1>
      <p className={styles.lead}>Un’idea, quattro piattaforme.</p>
      <ul className={styles.points}>
        <li>
          Scrivi un’idea: l’AI prepara le bozze per LinkedIn, Instagram, TikTok, YouTube e il tuo
          blog.
        </li>
        <li>
          Le rivedi, le approvi e le metti in calendario: Prisma le pubblica all’orario giusto.
        </li>
        <li>Tutto resta sul tuo computer, con le tue app e le tue chiavi.</li>
      </ul>
    </div>
  );
}

function BrandStep({ onSaved }: { onSaved: () => void }) {
  const { brand } = useBrand();
  const tags = useTags();
  const save = useSaveBrandSetup();
  // Riaperta dalle Impostazioni: parte dal brand attuale (il nome predefinito non si propone).
  const [name, setName] = useState(brand && brand.name !== DEFAULT_BRAND.name ? brand.name : '');
  const [initials, setInitials] = useState(
    brand && brand.name !== DEFAULT_BRAND.name ? brand.initials : '',
  );
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('');
  const current = chosen ?? (tags.data ?? []).map((tag) => tag.name);

  const addTag = () => {
    const tag = normalizeTag(draft);
    if (tag && !current.some((name) => name.toLowerCase() === tag.toLowerCase())) {
      setChosen([...current, tag]);
    }
    setDraft('');
  };

  return (
    <>
      <h1 id="setup-title" className={styles.title}>
        Il tuo brand
      </h1>
      <p className={styles.lead}>
        Il nome con cui firmi i contenuti e gli argomenti di cui parli: servono a ordinare le idee.
      </p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>Nome</span>
          <input
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Es. Marta Rossi o il nome del tuo progetto"
            autoFocus
          />
        </label>
        <label className={styles.fieldSmall}>
          <span className={styles.label}>Iniziali</span>
          <input
            className={`${styles.input} mono`}
            value={initials}
            maxLength={3}
            onChange={(event) => setInitials(event.target.value.toUpperCase())}
            placeholder={initialsFrom(name) || 'MR'}
          />
        </label>
      </div>
      <span className={styles.label}>Argomenti</span>
      <div className={styles.tags}>
        {current.map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
            <button
              type="button"
              aria-label={`Togli ${tag}`}
              onClick={() => setChosen(current.filter((item) => item !== tag))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className={styles.tagInput}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          placeholder="Aggiungi un argomento e premi Invio"
        />
      </div>
      <div className={styles.actions}>
        <Button
          disabled={!brand || !name.trim() || save.isPending}
          onClick={() =>
            save.mutate(
              {
                brandId: brand!.id,
                name,
                initials,
                existingTags: tags.data ?? [],
                tags: current,
              },
              { onSuccess: onSaved },
            )
          }
        >
          {save.isPending ? 'Salvo…' : 'Salva e continua'}
        </Button>
      </div>
      {save.error ? (
        <p role="alert" className={styles.error}>
          {errorMessage(save.error)}
        </p>
      ) : null}
    </>
  );
}
