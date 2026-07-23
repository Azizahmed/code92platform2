import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import MemberActions from './MemberActions';

export type MemberRow = {
  user_id: string;
  display_name: string;
  role: 'admin' | 'member';
  is_active: boolean;
  created_at: string;
};

type Props = {
  members: MemberRow[];
  currentUserId: string;
};

const thClass =
  'px-3 py-2 text-start text-[11px] font-medium uppercase tracking-widest text-faint';
const tdClass = 'border-t border-hairline px-3 py-2.5 align-top';

// Team roster with per-row activation/role actions via the admin_set_member
// RPC (see MemberActions).
export default function MembersTable({members, currentUserId}: Props) {
  const t = useTranslations('admin');

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t('members.title')}</h2>
      <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-raised/50">
              <th className={thClass}>{t('members.name')}</th>
              <th className={thClass}>{t('members.userId')}</th>
              <th className={thClass}>{t('members.role')}</th>
              <th className={thClass}>{t('members.status')}</th>
              <th className={thClass}>{t('members.joined')}</th>
              <th className={thClass}>{t('members.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${tdClass} text-center text-muted`}>
                  {t('members.empty')}
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.user_id}>
                  <td className={tdClass}>
                    <span className="font-medium">{member.display_name}</span>
                    {member.user_id === currentUserId ? (
                      <span className="ms-1.5 text-[11px] text-faint">
                        ({t('members.you')})
                      </span>
                    ) : null}
                  </td>
                  <td className={tdClass}>
                    <span
                      dir="ltr"
                      title={member.user_id}
                      className="font-mono text-xs text-muted"
                    >
                      {member.user_id.slice(0, 8)}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[11px] ${
                        member.role === 'admin'
                          ? 'border-accent/30 bg-accent/10 text-accent'
                          : 'border-hairline bg-raised text-muted'
                      }`}
                    >
                      {t(`members.roles.${member.role}`)}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          member.is_active ? 'bg-accent' : 'bg-faint'
                        }`}
                      />
                      {t(
                        member.is_active
                          ? 'members.states.active'
                          : 'members.states.inactive'
                      )}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <RelativeTime date={member.created_at} />
                  </td>
                  <td className={tdClass}>
                    <MemberActions
                      userId={member.user_id}
                      role={member.role}
                      isActive={member.is_active}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
