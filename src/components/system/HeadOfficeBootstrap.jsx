import { useEffect, useRef } from 'react';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useBranches } from '@/hooks/useBranches.js';
import { firestoreBranchRepository } from '@/infra/repositories/firestoreBranchRepository.js';
import { ROLES } from '@/domain/roles.js';

const HEAD_OFFICE_NAME_PATTERN = /(главн|head|hq|կենտր|գլխ)/i;

function isHeadOfficeName(name) {
  if (!name || typeof name !== 'object') return false;
  return ['ru', 'en', 'hy'].some((lng) => {
    const v = name[lng];
    return typeof v === 'string' && HEAD_OFFICE_NAME_PATTERN.test(v);
  });
}

/**
 * Side-effect-only component. Renders nothing.
 *
 * On first super_admin sign-in (or any subsequent one if the org somehow
 * lost its head office), checks the branches catalog. If no branch is
 * flagged `isPrimary === true` AND no branch's name matches the head
 * office naming pattern, creates a new "Главный Офис / Head Office /
 * Գլխավոր Օֆիս" branch with `isPrimary: true`.
 *
 * Idempotent: a single attempt per page load. The next sign-in re-checks
 * cheaply and no-ops because the freshly-created branch satisfies the
 * primary check.
 */
export default function HeadOfficeBootstrap() {
  const { user, role } = useAuth();
  const { data: branches, loading } = useBranches();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (role !== ROLES.SUPER_ADMIN) return;
    if (!user) return;
    if (loading) return;

    const hasPrimary = branches.some((b) => b.isPrimary === true);
    const hasNamed = branches.some((b) => isHeadOfficeName(b.name));
    if (hasPrimary || hasNamed) return;

    attempted.current = true;
    firestoreBranchRepository
      .create(
        {
          name: { ru: 'Главный Офис', en: 'Head Office', hy: 'Գլխավոր Օֆիս' },
          type: 'branch',
          address: '',
          responsibleEmployeeId: null,
          isActive: true,
          isPrimary: true,
        },
        { uid: user.uid, role }
      )
      .then(() => {
        console.info('[AMS] head-office branch created');
      })
      .catch((err) => {
        console.warn('[AMS] head-office bootstrap skipped:', err?.code ?? err?.message ?? err);
      });
  }, [user, role, branches, loading]);

  return null;
}
