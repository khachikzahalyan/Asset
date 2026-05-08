import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Warehouse, User, Users, HardDrive } from 'lucide-react';

import { Dialog } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import MultiLangInput from '@/components/common/MultiLangInput/MultiLangInput.jsx';

import {
  emptyAssetSubtypeInput,
  sanitizeAssetSubtypeInput,
  validateAssetSubtypeInput,
  AssetSubtypeIdConflictError,
} from '@/domain/assetSubtypes.js';
import {
  emptyCategoryInput,
  sanitizeCategoryInput,
  validateCategoryInput,
  INVENTORY_PREFIX_REGEX,
} from '@/domain/categories.js';
import { ASSIGNMENT_KIND_LIST } from '@/domain/assets.js';
import { localize } from '@/lib/localize.js';

/**
 * Modal that creates or edits an asset subtype.
 *
 * Wave A.7 reshape: the category field is no longer a `<select>`. It's a
 * typeahead `<input>` that matches the typed text against the localized
 * names of existing categories (case-insensitive).
 *
 * Wave A.8 trim: when the typed text doesn't match any existing category
 * the dialog used to reveal an inventory-code prefix input plus a
 * multi-language toggle. Both are gone now — this dialog is for catalog
 * CRUD by Super Admin and the inventory code itself is generated
 * downstream by tech_admin / asset_admin during asset creation. Per
 * AMS_Plan_v3.md line 95 the prefix lives on the Category record; if the
 * operator wants to override the auto-derived prefix (e.g. switch from
 * `TRANSPORT` to `400`) they go to /settings/categories afterwards. The
 * second `MultiLangInput` (one for the new category, one for the subtype)
 * was also removed — feedback was "в 1 месте, а не в 2 то же самое". New
 * categories minted from this dialog are always created with
 * `requiresMultilang: false`; flip it on /settings/categories if needed.
 *
 * On submit the dialog reports back to its parent via
 * `onSubmit(input, opts)`:
 *
 *   - Existing category picked  → opts = { id: subtypeDocId }
 *   - New category typed        → opts = {
 *       id: subtypeDocId,
 *       newCategory: { id: derivedCategoryId, input: sanitizedCategoryInput }
 *     }
 *
 * The parent (page) is responsible for calling
 * `firestoreCategoryRepository.create(...)` BEFORE
 * `firestoreAssetSubtypeRepository.create(...)` when `newCategory` is
 * present. We deliberately do NOT wrap the two writes in a single
 * Firestore transaction — cross-collection transactions are heavy and
 * the orphan-category recovery path (just retry the subtype with the
 * already-created category) is acceptable. See SubtypeManagementPage
 * `handleSubmit` for the full retry-on-CategoryIdConflictError flow.
 *
 * Edit mode: the category and id are immutable post-create. The dialog
 * shows the resolved category name as a disabled input.
 *
 * Hidden in Wave A.7: the read-only "derivedId" display field. The slug
 * is still computed for the parent's `opts.id`, but operators no longer
 * see it — the user feedback was "зачем нам ID?". The derivation can be
 * inspected via the dialog's `data-derived-id` attribute or React devtools.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('@/domain/assetSubtypes.js').AssetSubtype | null} [props.subtype]
 * @param {{ categoryId: string, name: any, requiresMultilang?: boolean, isActive?: boolean, inventoryCodePrefix?: string }[]} props.categories
 * @param {string} [props.defaultCategoryId]
 *   Optional initial categoryId for create mode. Used when the dialog is
 *   embedded into a context that already knows the category (e.g. inline
 *   creation from the asset form). Ignored in edit mode — the saved
 *   subtype's categoryId always wins.
 * @param {(input: import('@/domain/assetSubtypes.js').AssetSubtypeInput, opts: { id?: string, newCategory?: { id: string, input: import('@/domain/categories.js').CategoryInput } }) => Promise<void>} props.onSubmit
 */
export default function SubtypeFormDialog({
  open,
  onClose,
  subtype,
  categories,
  defaultCategoryId,
  onSubmit,
}) {
  const { t, i18n } = useTranslation(['assets', 'common']);
  const isEdit = Boolean(subtype);
  const lng = i18n.resolvedLanguage ?? 'ru';

  // When the dialog is opened from a specific category card (operator clicked
  // "+ Добавить подтип" inside a category, not the global "+ Добавить
  // категорию"), the category is locked — it goes into the dialog title and
  // the typeahead is suppressed entirely. Changing it would let an operator
  // accidentally create a sub-type under the wrong category. The typeahead
  // is reserved for the global add-flow where the operator may want to mint
  // a brand-new category from scratch.
  const lockedCategory = useMemo(() => {
    if (isEdit) return null;
    const id = (defaultCategoryId ?? '').trim();
    if (!id) return null;
    return (categories || []).find((c) => c.categoryId === id) ?? null;
  }, [isEdit, defaultCategoryId, categories]);

  // sortOrder strategy (Wave A.5):
  //  - On create: not shown to the operator. We auto-assign Date.now() at
  //    submit time so existing sortOrder-based ordering keeps working
  //    monotonically (newer items sort after older items by default).
  //  - On edit: not shown either. We re-emit the saved sortOrder verbatim
  //    so updates never reshuffle existing ordering.
  const initial = useMemo(() => {
    if (!subtype) {
      const empty = emptyAssetSubtypeInput();
      const seedCategoryId = (defaultCategoryId ?? '').trim();
      return {
        ...empty,
        categoryId: seedCategoryId || empty.categoryId,
      };
    }
    return {
      categoryId: subtype.categoryId,
      name: {
        ru: subtype.name?.ru ?? '',
        en: subtype.name?.en ?? '',
        hy: subtype.name?.hy ?? '',
      },
      requiresMultilang: Boolean(subtype.requiresMultilang),
      attachableTo: Array.isArray(subtype.attachableTo)
        ? subtype.attachableTo
        : [],
      sortOrder: subtype.sortOrder ?? 0,
      isActive: subtype.isActive !== false,
    };
  }, [subtype, defaultCategoryId]);

  const [form, setForm] = useState(initial);
  // Typeahead state for the category field (Wave A.7). Carries the raw
  // string the user is typing/picked, separate from `form.categoryId`
  // because the operator may have typed text that doesn't match any
  // existing category yet — in which case `form.categoryId` is empty
  // and we're in "new category" mode.
  const [categoryQuery, setCategoryQuery] = useState('');
  // Wave A.8: new-category mode is always single-language and the prefix
  // is auto-derived at submit time from the typed name's slug. We still
  // hold a local "in-flight category" object so the existing sanitize +
  // validate pipeline keeps working; we just don't expose any of its
  // fields to the operator.
  const [categoryNew, setCategoryNew] = useState(() => ({
    ...emptyCategoryInput(),
    requiresMultilang: false,
  }));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setErrors({});
    setSubmitError(null);
    setCategoryNew({ ...emptyCategoryInput(), requiresMultilang: false });
    // Seed the typeahead query string from the resolved category name
    // (edit mode) or from any defaultCategoryId we were passed.
    if (subtype) {
      const cat = (categories || []).find(
        (c) => c.categoryId === subtype.categoryId
      );
      setCategoryQuery(cat ? localize(cat.name, lng) : subtype.categoryId);
    } else if (defaultCategoryId) {
      const cat = (categories || []).find(
        (c) => c.categoryId === defaultCategoryId
      );
      setCategoryQuery(cat ? localize(cat.name, lng) : '');
    } else {
      setCategoryQuery('');
    }
  }, [open, initial, subtype, defaultCategoryId, categories, lng]);

  const trimmedQuery = categoryQuery.trim();

  // Suggestions: case-insensitive substring match of the typed text
  // against each category's localized name. Empty query → show all.
  const suggestions = useMemo(() => {
    const list = categories || [];
    if (!trimmedQuery) return list;
    const needle = trimmedQuery.toLowerCase();
    return list.filter((c) => {
      const localized = localize(c.name, lng) ?? '';
      return localized.toLowerCase().includes(needle);
    });
  }, [categories, trimmedQuery, lng]);

  // Exact-match resolution: if the user has typed (or clicked) something
  // that matches a real category name 1:1, treat it as "existing
  // category mode" and pre-fill form.categoryId. Otherwise we're in
  // "new category mode" and the create-category fields render below.
  const resolvedExistingCategory = useMemo(() => {
    if (!trimmedQuery) return null;
    const needle = trimmedQuery.toLowerCase();
    return (
      (categories || []).find(
        (c) => (localize(c.name, lng) ?? '').toLowerCase() === needle
      ) ?? null
    );
  }, [categories, trimmedQuery, lng]);

  const isNewCategoryMode =
    !isEdit && Boolean(trimmedQuery) && !resolvedExistingCategory;

  // Sync form.categoryId from the resolved suggestion (or clear it when
  // we drop into new-category mode). This keeps the rest of the form's
  // logic — selectedCategory, requiresMultilang, isLicenseCategory —
  // working against the existing-category branch.
  useEffect(() => {
    if (isEdit) return;
    setForm((f) => {
      const nextCategoryId = resolvedExistingCategory
        ? resolvedExistingCategory.categoryId
        : '';
      if (f.categoryId === nextCategoryId) return f;
      return { ...f, categoryId: nextCategoryId };
    });
  }, [isEdit, resolvedExistingCategory]);

  // When the user enters new-category mode and types a name, mirror that
  // typed text into the prospective category's RU/EN/HY name AND auto-
  // derive the inventory-code prefix from the slug. Dialog is now single-
  // language and prefix-less from the operator's POV (Wave A.8); both
  // values still need to live on the in-flight category object so the
  // existing sanitize + validate pipeline accepts it. Operators who want
  // a numeric prefix like `400` edit it on /settings/categories.
  useEffect(() => {
    if (!isNewCategoryMode) return;
    setCategoryNew((prev) => ({
      ...prev,
      name: { ru: trimmedQuery, en: trimmedQuery, hy: trimmedQuery },
      inventoryCodePrefix: deriveAutoPrefix(trimmedQuery),
    }));
  }, [isNewCategoryMode, trimmedQuery]);

  const selectedCategory = isEdit
    ? (categories || []).find((c) => c.categoryId === form.categoryId) ?? null
    : resolvedExistingCategory;

  // Allowed holder kinds for this subtype:
  //   - Existing/edit mode: the parent category's array
  //   - New-category mode: all 5 (the new category is being minted here)
  // Empty/missing array on the parent category falls back to all 5 so the
  // dialog still works against legacy un-migrated docs.
  const allowedAttachableKinds = useMemo(() => {
    if (isNewCategoryMode) return ASSIGNMENT_KIND_LIST;
    const fromCategory = selectedCategory?.attachableTo;
    if (Array.isArray(fromCategory) && fromCategory.length > 0) {
      return ASSIGNMENT_KIND_LIST.filter((k) => fromCategory.includes(k));
    }
    return ASSIGNMENT_KIND_LIST;
  }, [isNewCategoryMode, selectedCategory]);

  // When the resolved category changes, prune the subtype's attachableTo to
  // only kinds the new parent allows — picks made against the previous
  // category should not leak through.
  useEffect(() => {
    if (isEdit) return;
    setForm((f) => {
      const allowedSet = new Set(allowedAttachableKinds);
      const pruned = (f.attachableTo ?? []).filter((k) => allowedSet.has(k));
      if (pruned.length === (f.attachableTo ?? []).length) return f;
      return { ...f, attachableTo: pruned };
    });
  }, [isEdit, allowedAttachableKinds]);

  // For an existing category we inherit `requiresMultilang` from the
  // category. For a brand-new category (isNewCategoryMode) the dialog is
  // always single-language (Wave A.8), so the subtype name renders as a
  // single <Input> too. In edit mode we trust the saved subtype's flag
  // (in case the category flipped post-create).
  const requiresMultilang = isEdit
    ? form.requiresMultilang
    : isNewCategoryMode
      ? false
      : Boolean(selectedCategory?.requiresMultilang);

  const derivedSubtypeId = useMemo(() => {
    if (isEdit) return subtype.subtypeId;
    if (isNewCategoryMode) {
      const newCatId = deriveCategoryIdSlug(categoryNew.name);
      return deriveSubtypeId(newCatId, form.name);
    }
    return deriveSubtypeId(form.categoryId, form.name);
  }, [isEdit, subtype, isNewCategoryMode, categoryNew.name, form.categoryId, form.name]);

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function setName(next) {
    setField('name', next);
  }

  function toggleAttachableKind(kind, checked) {
    setForm((prev) => {
      const set = new Set(prev.attachableTo ?? []);
      if (checked) set.add(kind);
      else set.delete(kind);
      const next = ASSIGNMENT_KIND_LIST.filter((k) => set.has(k));
      return { ...prev, attachableTo: next };
    });
  }

  function pickSuggestion(cat) {
    // Click-to-fill: lock the typed text to the category's localized
    // name, which makes the resolver flip it to existing-category mode.
    setCategoryQuery(localize(cat.name, lng) ?? '');
  }

  async function handleSubmit(e) {
    e.preventDefault();

    // Bail out if the user submitted an empty category field — neither
    // existing nor new category resolved.
    if (!isEdit && !resolvedExistingCategory && !isNewCategoryMode) {
      setErrors({ categoryId: 'errorRequired' });
      return;
    }

    // sortOrder source of truth (see comment near `initial`).
    const nextSortOrder = isEdit ? form.sortOrder ?? 0 : Date.now();
    const sanitizedSubtype = sanitizeAssetSubtypeInput({
      ...form,
      sortOrder: nextSortOrder,
      requiresMultilang,
    });

    // For new-category mode, also sanitize+validate the prospective
    // category. Both must be valid; otherwise the dialog stays open and
    // shows the appropriate field errors.
    let newCategoryPayload = null;
    if (isNewCategoryMode) {
      // Wave A.8: prefix is auto-derived from the typed name (the
      // useEffect above keeps it in sync). If the name is all-Cyrillic
      // or all-Armenian the slug is empty → surface a dedicated error
      // pointing the operator at /settings/categories where they can
      // type the latin prefix manually.
      const autoPrefix = deriveAutoPrefix(trimmedQuery);
      if (!autoPrefix) {
        setErrors({ categoryId: 'subtypeAdminCategoryNameNeedsAscii' });
        return;
      }
      // In new-category mode, the operator picks the holder kinds via the
      // subtype's fieldset; we mirror them into the prospective category so
      // both records get the same configuration.
      const sanitizedCategory = sanitizeCategoryInput({
        ...categoryNew,
        inventoryCodePrefix: autoPrefix,
        attachableTo: sanitizedSubtype.attachableTo ?? [],
      });
      const categoryFieldErrors = validateCategoryInput(sanitizedCategory);
      const subtypeFieldErrors = validateAssetSubtypeInput(
        {
          ...sanitizedSubtype,
          // The subtype's categoryId comes from the new category's slug.
          categoryId: deriveCategoryIdSlug(sanitizedCategory.name) || 'pending',
        },
        { category: sanitizedCategory }
      );
      const allErrors = mergeFieldErrors(subtypeFieldErrors, categoryFieldErrors);
      if (Object.keys(allErrors).length > 0) {
        setErrors(allErrors);
        return;
      }
      const newCategoryId = deriveCategoryIdSlug(sanitizedCategory.name);
      if (!newCategoryId) {
        setErrors({ categoryId: 'errorRequired' });
        return;
      }
      newCategoryPayload = { id: newCategoryId, input: sanitizedCategory };
      // Make sure the subtype payload's categoryId points at the new
      // category's slug — the parent will create the category under
      // exactly this id before creating the subtype.
      sanitizedSubtype.categoryId = newCategoryId;
    } else {
      const parentCategory = (categories || []).find(
        (c) => c.categoryId === sanitizedSubtype.categoryId
      );
      const subtypeFieldErrors = validateAssetSubtypeInput(
        sanitizedSubtype,
        { category: parentCategory ?? null }
      );
      if (Object.keys(subtypeFieldErrors).length > 0) {
        setErrors(subtypeFieldErrors);
        return;
      }
    }

    setErrors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Recompute the doc id against the (possibly just-finalized)
      // categoryId so the parent stores the subtype under the correct slug.
      const finalSubtypeId = deriveSubtypeId(
        sanitizedSubtype.categoryId,
        sanitizedSubtype.name
      );
      await onSubmit(sanitizedSubtype, {
        id: finalSubtypeId,
        newCategory: newCategoryPayload,
      });
    } catch (err) {
      if (err instanceof AssetSubtypeIdConflictError) {
        setSubmitError(t('assets:subtypeAdminErrorIdConflict'));
      } else if (err?.code === 'subtype/orphan-category') {
        setSubmitError(t('assets:errorSubtypeCreatedAfterCategoryFail'));
      } else {
        setSubmitError(err?.message ?? String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={
        isEdit
          ? t('assets:subtypeAdminDialogEditTitle')
          : lockedCategory
            ? t('assets:subtypeAdminDialogCreateInCategoryTitle', {
                name: localize(lockedCategory.name, lng),
              })
            : t('assets:subtypeAdminDialogCreateTitle')
      }
      closeLabel={t('common:cancel')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('assets:subtypeAdminCancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
            {submitting ? <Spinner size={14} /> : null}
            {t('assets:subtypeAdminSave')}
          </Button>
        </>
      }
    >
      {/* The derived id is hidden from the UI in Wave A.7 but kept in
          a data-* attribute for ad-hoc debugging via devtools. */}
      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        data-derived-id={derivedSubtypeId || ''}
      >
        {/* Category section. Three render modes:
              - Edit mode: read-only text (immutable post-create).
              - Locked mode (defaultCategoryId): the category is in the dialog
                title; we don't render the field at all.
              - Free mode (global add): typeahead with suggestions; supports
                creating a brand-new category by typing a non-matching name. */}
        {lockedCategory ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="subtype-category">
            {t('assets:subtypeAdminFieldCategory')}
          </Label>
          {isEdit ? (
            // Edit mode: category is immutable. Render as plain read-only
            // text — a disabled <Input> is misleading (looks editable, isn't)
            // and there's no scenario where flipping a "Касперский" subtype
            // from "Лицензии" to "Мебель" makes sense.
            <p
              id="subtype-category"
              className="text-sm font-medium text-foreground"
              data-testid="subtype-category-readonly"
            >
              {categoryQuery}
            </p>
          ) : (
            <>
              <Input
                id="subtype-category"
                name="categoryId"
                value={categoryQuery}
                onChange={(e) => setCategoryQuery(e.target.value)}
                placeholder={t('assets:subtypeAdminCategoryPlaceholder')}
                disabled={submitting}
                aria-invalid={Boolean(errors.categoryId)}
                autoComplete="off"
              />
              {/* Suggestions: render only when the user has typed text or
                  has focused the field with categories available. We keep
                  the list small (<=8) and clickable. */}
              {suggestions.length > 0 ? (
                <ul
                  aria-label={t('assets:subtypeAdminCategorySuggestionsLabel')}
                  className="rounded-md border border-input bg-background"
                >
                  {suggestions.slice(0, 8).map((c) => (
                    <li key={c.categoryId}>
                      <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                        onClick={() => pickSuggestion(c)}
                        disabled={submitting}
                      >
                        {localize(c.name, lng)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {/* Inline hint about which mode we're in. */}
              {resolvedExistingCategory ? (
                <p className="text-xs text-muted-foreground">
                  {t('assets:subtypeAdminCategoryHintExisting', {
                    name: localize(resolvedExistingCategory.name, lng),
                  })}
                </p>
              ) : isNewCategoryMode ? (
                <p className="text-xs text-emerald-700">
                  {t('assets:subtypeAdminCategoryHintNew', { name: trimmedQuery })}
                </p>
              ) : null}
            </>
          )}
          {errors.categoryId ? (
            <p className="text-xs text-destructive">{t(`assets:${errors.categoryId}`)}</p>
          ) : null}
        </div>
        )}

        {/* Wave A.8: the new-category subgroup (prefix input + multilang
            toggle + second MultiLangInput) was removed. Inventory codes
            are generated by tech_admin/asset_admin during asset creation
            (AMS_Plan_v3.md §95), not here. The prefix gets auto-derived
            from the typed name's slug at submit time and the operator
            can edit it later on /settings/categories if they want a
            numeric code (e.g. "400"). The multilang toggle was a second
            MultiLangInput right next to the subtype's own — confusing
            duplication; one entry point lives on /settings/categories. */}

        <div className="space-y-1.5">
          <Label>{t('assets:subtypeAdminFieldName')}</Label>
          {requiresMultilang ? (
            <MultiLangInput
              name="name"
              value={form.name}
              onChange={setName}
              disabled={submitting}
              invalid={Boolean(errors.name)}
            />
          ) : (
            <Input
              name="name"
              value={typeof form.name === 'string' ? form.name : form.name?.ru ?? ''}
              onChange={(e) =>
                setName({ ru: e.target.value, en: e.target.value, hy: e.target.value })
              }
              disabled={submitting}
              aria-invalid={Boolean(errors.name)}
            />
          )}
          {errors.name ? (
            <p className="text-xs text-destructive">{t(`assets:${errors.name}`)}</p>
          ) : null}
        </div>

        <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
          <div className="space-y-1">
            <legend className="px-0 text-sm font-semibold">
              {t('assets:subtypeAdminAttachableLegend')}
            </legend>
            <p className="text-xs text-muted-foreground">
              {t('assets:subtypeAdminAttachableHelp')}
            </p>
          </div>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            role="group"
            aria-invalid={Boolean(errors.attachableTo)}
          >
            {allowedAttachableKinds.map((kind) => {
              const id = `subtype-attachable-${kind}`;
              const checked = (form.attachableTo ?? []).includes(kind);
              const labelKey = `assets:assignmentKind${kind.charAt(0).toUpperCase() + kind.slice(1)}`;
              const Icon = ATTACHABLE_KIND_ICON[kind] ?? Building2;
              return (
                <label
                  key={kind}
                  htmlFor={id}
                  className={[
                    'group relative flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors',
                    checked
                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                      : 'border-input bg-background text-foreground hover:border-primary/40 hover:bg-primary/5',
                    submitting ? 'pointer-events-none opacity-60' : '',
                  ].join(' ')}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleAttachableKind(kind, e.target.checked)}
                    disabled={submitting}
                    className="sr-only"
                    aria-invalid={Boolean(errors.attachableTo)}
                  />
                  <span
                    className={[
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
                      checked
                        ? 'bg-primary-foreground/15 text-primary-foreground'
                        : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary',
                    ].join(' ')}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="flex-1 font-medium">{t(labelKey)}</span>
                </label>
              );
            })}
          </div>
          {errors.attachableTo ? (
            <p className="text-xs text-destructive">
              {t(`assets:${errors.attachableTo}`)}
            </p>
          ) : null}
        </fieldset>

        {/* isActive is meaningful only in edit mode (Wave A.6). */}
        {isEdit ? (
          <div className="flex items-center gap-2">
            <input
              id="subtype-is-active"
              type="checkbox"
              checked={form.isActive !== false}
              onChange={(e) => setField('isActive', e.target.checked)}
              disabled={submitting}
              className="h-4 w-4"
            />
            <Label htmlFor="subtype-is-active" className="cursor-pointer">
              {t('assets:subtypeAdminFieldIsActive')}
            </Label>
          </div>
        ) : null}

        {submitError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/**
 * Build the stable subtype doc id from the chosen category and the subtype name.
 *
 * Strategy: prefer English name, then Russian, then Armenian. Lowercase,
 * collapse non-`[a-z0-9]` runs (post-Latin transliteration is a no-op for
 * Armenian/Cyrillic — we just throw those characters away and demand the
 * user type a name in at least one of EN/RU). If the resulting slug is
 * empty, return ''.
 */
function deriveSubtypeId(categoryId, name) {
  const trimmedCategoryId = (categoryId ?? '').trim();
  if (!trimmedCategoryId) return '';
  const candidates = [
    name?.en,
    name?.ru,
    name?.hy,
    typeof name === 'string' ? name : '',
  ];
  for (const c of candidates) {
    const slug = slugify(c);
    if (slug) return `${trimmedCategoryId}_${slug}`;
  }
  return '';
}

/**
 * Build the stable category doc id from a CategoryName map. Mirrors
 * the priority used by CategoryFormDialog.deriveCategoryId so that
 * inline-create-category-from-subtype-dialog produces the same slug
 * the operator would have gotten on /settings/categories.
 */
function deriveCategoryIdSlug(name) {
  const candidates = [
    name?.ru,
    name?.en,
    name?.hy,
    typeof name === 'string' ? name : '',
  ];
  for (const c of candidates) {
    const slug = slugify(c);
    if (slug) return slug;
  }
  return '';
}

function slugify(value) {
  if (!value) return '';
  const lowered = String(value).toLowerCase();
  const ascii = lowered.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ascii;
}

/**
 * Wave A.8: auto-derive the inventory-code prefix from the typed category
 * name. The prefix must satisfy `INVENTORY_PREFIX_REGEX = /^[A-Z0-9]+$/`
 * so we slug the input, drop the `_` separators slugify inserts, and
 * uppercase. Returns '' when the input is all-non-ASCII (caller surfaces
 * `subtypeAdminCategoryNameNeedsAscii` in that case).
 *
 * Examples:
 *   "Transport"       → "TRANSPORT"
 *   "Tech Devices"    → "TECHDEVICES"
 *   "Тех средства"    → ""              (operator must edit on /settings/categories)
 */
function deriveAutoPrefix(value) {
  const slug = slugify(value);
  if (!slug) return '';
  return slug.replace(/_+/g, '').toUpperCase();
}

const ATTACHABLE_KIND_ICON = {
  branch: Building2,
  warehouse: Warehouse,
  employee: User,
  department: Users,
  asset: HardDrive,
};

/**
 * Combine subtype-side and category-side validation errors into a single
 * record. Per-namespace lookups in the JSX point either at `assets:*`
 * (subtype errors) or `categories:*` (category errors); we just need the
 * field name to be unique. Subtype errors win on collision so the dialog
 * surfaces the most actionable message.
 */
function mergeFieldErrors(subtypeErrors, categoryErrors) {
  const merged = { ...categoryErrors, ...subtypeErrors };
  return merged;
}

// Re-export so callers can detect id conflicts via instanceof if needed.
export { AssetSubtypeIdConflictError, INVENTORY_PREFIX_REGEX };
