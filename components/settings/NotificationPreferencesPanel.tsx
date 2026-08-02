'use client';

import {useState, useTransition} from 'react';
import {Bell} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {saveNotificationPreferencesAction} from '@/lib/actions/notifications';
import type {NotificationPreferences} from '@/lib/notifications';

function Toggle({
  label,
  hint,
  checked,
  disabled = false,
  onChange
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-md border border-hairline p-3 transition-colors ${
        disabled ? 'opacity-50' : 'cursor-pointer hover:bg-raised/40'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">
          {hint}
        </span>
      </span>
    </label>
  );
}

// In-app notifications are not optional — they are the bell, and switching them
// off would just be a way to miss work. Email is, which is why this panel is
// entirely about email.
export default function NotificationPreferencesPanel({
  preferences
}: {
  preferences: NotificationPreferences;
}) {
  const t = useTranslations('notifications');
  const [emailEnabled, setEmailEnabled] = useState(preferences.email_enabled);
  const [onAssign, setOnAssign] = useState(preferences.email_on_assign);
  const [onUpdate, setOnUpdate] = useState(preferences.email_on_update);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: {
    emailEnabled: boolean;
    emailOnAssign: boolean;
    emailOnUpdate: boolean;
  }) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveNotificationPreferencesAction(next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  function update(patch: Partial<NotificationPreferences>) {
    const next = {
      emailEnabled: patch.email_enabled ?? emailEnabled,
      emailOnAssign: patch.email_on_assign ?? onAssign,
      emailOnUpdate: patch.email_on_update ?? onUpdate
    };
    setEmailEnabled(next.emailEnabled);
    setOnAssign(next.emailOnAssign);
    setOnUpdate(next.emailOnUpdate);
    save(next);
  }

  return (
    <section id="notifications" className="scroll-mt-8 space-y-3">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-muted" strokeWidth={1.75} />
        <h2 className="text-sm font-medium">{t('preferences.title')}</h2>
        {pending ? (
          <span className="text-[11px] text-faint">{t('preferences.saving')}</span>
        ) : saved ? (
          <span className="text-[11px] text-accent">{t('preferences.saved')}</span>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {t('preferences.intro')}
      </p>

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <div className="space-y-2 rounded-lg border border-hairline bg-panel p-3">
        <Toggle
          label={t('preferences.emailEnabled')}
          hint={t('preferences.emailEnabledHint')}
          checked={emailEnabled}
          onChange={(next) => update({email_enabled: next})}
        />
        <Toggle
          label={t('preferences.onAssign')}
          hint={t('preferences.onAssignHint')}
          checked={onAssign}
          disabled={!emailEnabled}
          onChange={(next) => update({email_on_assign: next})}
        />
        <Toggle
          label={t('preferences.onUpdate')}
          hint={t('preferences.onUpdateHint')}
          checked={onUpdate}
          disabled={!emailEnabled}
          onChange={(next) => update({email_on_update: next})}
        />
      </div>
    </section>
  );
}
