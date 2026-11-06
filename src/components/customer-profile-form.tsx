'use client';

import Link from 'next/link';
import { useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { employmentSchema } from '@/data/schemas';
import { centsToEuroInput, parseEuroInput } from '@/domain/money';
import { getT, type MessageKey } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import type { ApiEnvelope } from '@/server/api-response';
import type { CustomerProfile } from '@/server/features/customers/get-customer-profile';

type CustomerType = 'consumer' | 'sole_trader' | 'company';

export function CustomerProfileForm({
  locale,
  name,
  email,
  initial,
  onSaved,
  onCancel,
}: {
  locale: Locale;
  name: string;
  email: string;
  /** Editing an existing profile: fields start from it and the type is fixed. */
  initial?: CustomerProfile;
  onSaved?: (profile: CustomerProfile) => void;
  onCancel?: () => void;
}) {
  const t = getT(locale);
  const editing = initial !== undefined;
  const [type, setType] = useState<CustomerType>(initial?.type ?? 'consumer');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);

  function field(id: string, label: MessageKey, props: InputHTMLAttributes<HTMLInputElement> = {}) {
    const invalid = invalidFields.includes(id);
    return (
      <label className="profile-field" htmlFor={`profile-${id}`}>
        {t(label)}
        <input
          id={`profile-${id}`}
          name={id}
          required
          {...props}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'profile-error' : props['aria-describedby']}
        />
      </label>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (key: string) => String(data.get(key) ?? '').trim();
    setError(null);
    setInvalidFields([]);

    const amountField = type === 'consumer' ? 'monthlyNetIncomeCents' : 'annualRevenueCents';
    const cents = type === 'sole_trader' ? null : parseEuroInput(text(amountField));
    if (type !== 'sole_trader' && cents === null) {
      setInvalidFields([amountField]);
      setError('profile.moneyError');
      form.querySelector<HTMLInputElement>(`[name="${amountField}"]`)?.focus();
      return;
    }

    const body = {
      type,
      name: text('name'),
      country: text('country').toUpperCase(),
      city: text('city'),
      email: text('email'),
      ...(type !== 'company' ? { birthDate: text('birthDate') } : {}),
      ...(type === 'consumer'
        ? { employment: text('employment'), monthlyNetIncomeCents: cents }
        : { businessId: text('businessId'), vatRegistered: data.has('vatRegistered') }),
      ...(type === 'company'
        ? {
            annualRevenueCents: cents,
            applicantCanSign: data.has('applicantCanSign'),
            beneficialOwners: text('beneficialOwners')
              .split('\n')
              .map((owner) => owner.trim())
              .filter(Boolean),
          }
        : {}),
    };

    setPending(true);
    try {
      const response = await fetch('/api/customers', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status >= 500) {
        setError('profile.unavailable');
        return;
      }
      const result: ApiEnvelope<CustomerProfile | { customerId: string }> = await response.json();
      if (!response.ok || !result.success) {
        const code = !result.success ? result.error.code : '';
        if (code === 'VALIDATION_ERROR') {
          const details = !result.success ? result.error.details : undefined;
          const fields = Array.isArray(details)
            ? details.flatMap((issue: unknown) =>
                issue &&
                typeof issue === 'object' &&
                'path' in issue &&
                typeof issue.path === 'string'
                  ? [issue.path.split('.')[0] ?? issue.path]
                  : []
              )
            : [];
          setInvalidFields(fields);
          setError('profile.validationError');
          return;
        }
        setError(
          code === 'ALREADY_A_CUSTOMER'
            ? 'profile.alreadyExists'
            : code === 'TYPE_LOCKED'
              ? 'profile.typeLocked'
              : response.status === 401
                ? 'profile.signInAgain'
                : response.status === 403
                  ? 'profile.customerRequired'
                  : 'profile.unavailable'
        );
        return;
      }
      if (editing && 'id' in result.data) {
        onSaved?.(result.data);
        return;
      }
      window.location.assign(`/${locale}/leases`);
    } catch {
      setError('profile.networkError');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="profile-page" aria-labelledby="profile-heading">
      <h1 id="profile-heading">{t(editing ? 'profile.editTitle' : 'profile.title')}</h1>
      <p className="profile-intro">{t(editing ? 'profile.editIntro' : 'profile.intro')}</p>
      <form onSubmit={submit} aria-busy={pending}>
        <fieldset disabled={pending} className="profile-fields">
          <legend className="profile-legend">{t('profile.type')}</legend>
          {editing ? (
            <p className="profile-type-fixed">
              <strong>{t(`profile.${type}`)}</strong> · {t('profile.typeFixed')}
            </p>
          ) : (
            <div className="profile-types">
              {(['consumer', 'sole_trader', 'company'] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="type"
                    value={value}
                    checked={type === value}
                    onChange={() => {
                      setType(value);
                      setInvalidFields([]);
                      setError(null);
                    }}
                  />
                  {t(`profile.${value}`)}
                </label>
              ))}
            </div>
          )}
          <div className="profile-grid">
            {field('name', 'profile.name', {
              defaultValue: initial?.name ?? name,
              autoComplete: type === 'consumer' ? 'name' : 'organization',
              pattern: '.*\\S.*',
            })}
            {field('email', 'profile.email', {
              type: 'email',
              defaultValue: initial?.email ?? email,
              autoComplete: 'email',
            })}
            {field('country', 'profile.country', {
              defaultValue: initial?.country ?? 'FI',
              autoComplete: 'country',
              minLength: 2,
              maxLength: 2,
              pattern: '[A-Za-z]{2}',
              'aria-describedby': 'profile-country-hint',
            })}
            {field('city', 'profile.city', {
              defaultValue: initial?.city,
              autoComplete: 'address-level2',
              pattern: '.*\\S.*',
            })}
            {type !== 'company' &&
              field('birthDate', 'profile.birthDate', {
                type: 'date',
                defaultValue: initial?.birthDate ?? undefined,
                autoComplete: 'bday',
              })}
            {type === 'consumer' && (
              <>
                <label className="profile-field" htmlFor="profile-employment">
                  {t('profile.employment')}
                  <select
                    id="profile-employment"
                    name="employment"
                    required
                    defaultValue={initial?.employment ?? 'employed'}
                    aria-invalid={invalidFields.includes('employment') || undefined}
                    aria-describedby={
                      invalidFields.includes('employment') ? 'profile-error' : undefined
                    }
                  >
                    {employmentSchema.options.map((value) => (
                      <option key={value} value={value}>
                        {t(`profile.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {field('monthlyNetIncomeCents', 'profile.monthlyIncome', {
                  defaultValue:
                    initial?.monthlyNetIncomeCents != null
                      ? centsToEuroInput(initial.monthlyNetIncomeCents)
                      : undefined,
                  inputMode: 'decimal',
                  'aria-describedby': 'profile-money-hint',
                })}
              </>
            )}
            {type !== 'consumer' &&
              field('businessId', 'profile.businessId', {
                defaultValue: initial?.businessId ?? undefined,
                pattern: '.*\\S.*',
              })}
            {type === 'company' &&
              field('annualRevenueCents', 'profile.annualRevenue', {
                defaultValue:
                  initial?.annualRevenueCents != null
                    ? centsToEuroInput(initial.annualRevenueCents)
                    : undefined,
                inputMode: 'decimal',
                'aria-describedby': 'profile-money-hint',
              })}
          </div>
          <p id="profile-country-hint" className="profile-hint">
            {t('profile.countryHint')}
          </p>
          {type !== 'sole_trader' && (
            <p id="profile-money-hint" className="profile-hint">
              {t('profile.moneyHint')}
            </p>
          )}
          {type !== 'consumer' && (
            <label className="profile-check">
              <input
                type="checkbox"
                name="vatRegistered"
                defaultChecked={initial?.vatRegistered ?? false}
                aria-invalid={invalidFields.includes('vatRegistered') || undefined}
                aria-describedby={
                  invalidFields.includes('vatRegistered') ? 'profile-error' : undefined
                }
              />
              {t('profile.vatRegistered')}
            </label>
          )}
          {type === 'company' && (
            <>
              <label className="profile-check">
                <input
                  type="checkbox"
                  name="applicantCanSign"
                  defaultChecked={initial?.applicantCanSign ?? false}
                  aria-invalid={invalidFields.includes('applicantCanSign') || undefined}
                  aria-describedby={
                    invalidFields.includes('applicantCanSign') ? 'profile-error' : undefined
                  }
                />
                {t('profile.applicantCanSign')}
              </label>
              <label className="profile-field" htmlFor="profile-beneficialOwners">
                {t('profile.beneficialOwners')}
                <textarea
                  id="profile-beneficialOwners"
                  name="beneficialOwners"
                  defaultValue={initial?.beneficialOwners.join('\n')}
                  rows={3}
                  aria-invalid={invalidFields.includes('beneficialOwners') || undefined}
                  aria-describedby={`profile-owners-hint${invalidFields.includes('beneficialOwners') ? ' profile-error' : ''}`}
                />
              </label>
              <p id="profile-owners-hint" className="profile-hint">
                {t('profile.ownersHint')}
              </p>
            </>
          )}
          {error && (
            <p id="profile-error" role="alert" className="profile-error">
              {t(error)}
            </p>
          )}
          {error === 'profile.alreadyExists' && (
            <Link className="profile-link" href={`/${locale}/leases`}>
              {t('profile.goToLeases')}
            </Link>
          )}
          {error === 'profile.signInAgain' && (
            <Link className="profile-link" href={`/${locale}/login`}>
              {t('profile.login')}
            </Link>
          )}
          <div className="profile-actions">
            <button type="submit" className="profile-submit">
              {t(pending ? 'profile.saving' : editing ? 'profile.saveChanges' : 'profile.save')}
            </button>
            {editing && (
              <button type="button" className="profile-secondary" onClick={onCancel}>
                {t('profile.cancel')}
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  );
}
