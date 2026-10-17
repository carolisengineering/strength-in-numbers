import type { RecordCardModel } from "./recordCards";
import styles from "./RecordCardList.module.css";

/**
 * Spec 17.2 AC15, AC18-AC20: one card per exercise. A big lead record (brass gain or "First record", muted "was"), the
 * exercise's other records as name-only chips. Dumb: every decision is made by `buildRecordCards`. Static, no motion.
 */
export function RecordCards({ cards }: { cards: readonly RecordCardModel[] }) {
  return (
    <ul className={styles.cards}>
      {cards.map((card) => (
        <li key={card.key} className={styles.card}>
          <div className={styles.top}>
            <h3 className={styles.name}>{card.name}</h3>
            {card.setText === null ? null : <span className={styles.set}>{card.setText}</span>}
          </div>
          <p className={styles.label}>{card.lead.label}</p>
          <p className={styles.figure}>
            <span className={styles.value}>{card.lead.valueText}</span>
            {card.lead.first ? <span className={styles.gain}>First record</span> : card.lead.gainText === null ? null : <span className={styles.gain}>{card.lead.gainText}</span>}
          </p>
          {card.lead.wasText === null ? null : <p className={styles.was}>{card.lead.wasText}</p>}
          {card.chips.length === 0 ? null : (
            <ul className={styles.chips} aria-label={`Also set records for ${card.name}`}>
              {card.chips.map((chip) => (
                <li key={chip.type} className={styles.chip}>
                  {chip.label}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
