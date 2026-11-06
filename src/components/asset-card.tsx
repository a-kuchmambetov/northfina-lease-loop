import Image from 'next/image';
import type { CatalogueItem } from '@/domain/catalogue';
import { formatEuro } from '@/domain/money';
import { formatNumber } from '@/i18n/format';
import type { Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

export function AssetCard({
  item,
  locale,
  t,
  onDetails,
  onStart,
}: {
  item: CatalogueItem;
  locale: Locale;
  t: Translate;
  onDetails: () => void;
  onStart: () => void;
}) {
  const { asset, estimate } = item;
  return (
    <article aria-labelledby={`asset-${asset.id}`} className="equipment-card">
      <div className="equipment-photo">
        <div className="equipment-reference">
          <span>{t(`category.${asset.category}`)}</span>
          <span>{asset.id}</span>
        </div>
        <Image
          src={item.image}
          alt={t('catalogue.photoAlt', { category: t(`category.${asset.category}`) })}
          width={322}
          height={190}
          className="equipment-image"
          sizes="(max-width: 420px) 75vw, 322px"
        />
      </div>
      <div className="equipment-info">
        <h2 id={`asset-${asset.id}`}>
          {asset.make} {asset.model}
        </h2>
        <div className="equipment-price">
          <strong>
            {estimate?.ok
              ? formatEuro(estimate.monthlyNetCents, intlLocale[locale])
              : t('asset.noEstimate')}
          </strong>
          {estimate?.ok && <span>{t('catalogue.monthly')}</span>}
        </div>
        <dl className="equipment-facts">
          <Fact label={t('condition.label')} value={t(`condition.${asset.condition}`)} />
          <Fact
            label={t('asset.usage')}
            value={t(`usage.${asset.usage.unit}`, {
              value: formatNumber(asset.usage.value, locale),
            })}
          />
          <Fact
            label={t('asset.previousLives')}
            value={formatNumber(asset.previous_lives, locale)}
          />
          <Fact
            label={t('catalogue.availability')}
            value={t(
              asset.status === 'available' ? 'catalogue.availableNow' : `status.${asset.status}`
            )}
          />
        </dl>
        <div className="equipment-actions">
          <button type="button" className="lease-button" onClick={onStart}>
            {t('catalogue.startContract')}
          </button>
          <button type="button" className="info-button" onClick={onDetails}>
            {t('catalogue.moreInformation')}
          </button>
        </div>
      </div>
    </article>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
