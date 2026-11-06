'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Question } from '@/data/schemas';
import { parseEuroInput } from '@/domain/money';
import type { Answer } from '@/domain/question-flow';
import { getT, type MessageKey } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { CancelApplication } from './cancel-application';

type QuestionView = Pick<Question, 'id' | 'type' | 'options'> & {
  text: string;
  why: string;
  isBusinessId: boolean;
};

/** An earlier answer as the field shows it. Money is stored in cents, a list as an array. */
function fieldValue(answer: Answer | undefined): string {
  if (answer === undefined) return '';
  if (typeof answer === 'number') return (answer / 100).toFixed(2);
  return typeof answer === 'string' ? answer : answer.join('\n');
}

/** What the field holds as an answer for the API, or the message explaining why it can't be. */
function readAnswer(type: Question['type'], value: string): { answer: Answer } | MessageKey {
  if (type === 'list') {
    const lines = value.split('\n').map((line) => line.trim());
    return { answer: lines.filter(Boolean) };
  }
  const trimmed = value.trim();
  if (!trimmed) return 'application.required';
  if (type !== 'money') return { answer: trimmed };
  const cents = parseEuroInput(trimmed);
  return cents === null ? 'application.invalidMoney' : { answer: cents };
}

export function ApplicationQuestion({
  applicationId,
  locale,
  question,
  answer,
  contactDefault,
  previousQuestionId,
  progress,
  canCancel,
}: {
  applicationId: string;
  locale: Locale;
  question: QuestionView;
  answer: Answer | undefined;
  contactDefault?: string;
  previousQuestionId: string | null;
  progress: { answered: number; total: number };
  canCancel: boolean;
}) {
  const t = getT(locale);
  const router = useRouter();
  const path = `/${locale}/applications/${applicationId}`;
  const [value, setValue] = useState(
    answer === undefined ? (contactDefault ?? '') : fieldValue(answer)
  );
  const [error, setError] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // A new question replaces this form, so screen reader and keyboard users move with it.
  useEffect(() => heading.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const read = readAnswer(question.type, value);
    if (typeof read === 'string') {
      setError(read);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/applications/${applicationId}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, answer: read.answer }),
      });
      const body = await response.json();
      if (body.success) {
        const next = body.data.nextQuestion?.id;
        router.push(next ? `${path}?question=${next}` : path);
        router.refresh();
        return;
      }
      if (body.error?.code === 'INVALID_ANSWER_FORMAT') {
        setError(question.isBusinessId ? 'application.invalidBusinessId' : 'application.invalid');
      } else {
        setError('application.saveFailed');
        router.refresh();
      }
    } catch {
      setError('application.saveFailed');
    }
    setSaving(false);
  }

  const shared = {
    'aria-labelledby': 'question-text',
    'aria-describedby': error ? 'question-error' : 'question-why',
    'aria-invalid': error !== null,
    value,
  };
  const percent = progress.total ? Math.round((progress.answered / progress.total) * 100) : 0;

  return (
    <form className="application-panel application-question" onSubmit={submit} noValidate>
      <p className="application-eyebrow">
        {t('application.progress', { answered: progress.answered, total: progress.total })}
      </p>
      <div className="application-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <h2 id="question-text" ref={heading} tabIndex={-1}>
        {question.text}
      </h2>
      {question.options ? (
        <div
          className="application-options"
          role="radiogroup"
          aria-labelledby="question-text"
          aria-describedby={shared['aria-describedby']}
        >
          {question.options.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={question.id}
                value={option}
                checked={value === option}
                onChange={() => setValue(option)}
              />
              {/* Every option has a message; src/i18n/messages.test.ts checks them. */}
              <span>{t(`application.option.${option}` as MessageKey)}</span>
            </label>
          ))}
        </div>
      ) : question.type === 'list' ? (
        <textarea {...shared} rows={4} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <div className="application-field" data-type={question.type}>
          <input
            {...shared}
            type={question.type === 'money' || question.type === 'text' ? 'text' : question.type}
            inputMode={question.type === 'money' ? 'decimal' : undefined}
            placeholder={question.isBusinessId ? '1234567-8' : undefined}
            autoComplete={
              question.id === 'q_full_name' ? 'name' : question.id === 'q_email' ? 'email' : 'off'
            }
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      )}
      {question.type === 'list' && <p className="application-muted">{t('application.listHint')}</p>}
      {error && (
        <p id="question-error" className="application-error" role="alert">
          {t(error)}
        </p>
      )}
      <div id="question-why" className="application-why">
        <strong>{t('application.whyWeAsk')}</strong>
        <p>{question.why}</p>
      </div>
      <div className="application-actions application-question-actions">
        {canCancel && (
          <CancelApplication applicationId={applicationId} locale={locale} disabled={saving} />
        )}
        {previousQuestionId && (
          <Link href={`${path}?question=${previousQuestionId}`} className="info-button">
            ← {t('application.previous')}
          </Link>
        )}
        <button type="submit" className="lease-button" disabled={saving}>
          {t(saving ? 'application.saving' : 'application.continue')}
        </button>
      </div>
    </form>
  );
}
