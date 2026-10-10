'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CompanyFormValues {
  code?: number;
  nameAr: string;
  nameEn: string;
}

/**
 * Create (code + names) or rename (names only — code is immutable, it is
 * embedded in MinIO fileKeys). Returns an error message string on failure,
 * null on success; the parent owns the API call, toasts and invalidation.
 */
export function CompanyDialog(props: {
  mode: 'create' | 'edit';
  company?: { id: string; nameAr: string; nameEn: string };
  save: (values: CompanyFormValues) => Promise<string | null>;
  onClose: () => void;
}): JSX.Element {
  const t = useTranslations('admin');
  const [code, setCode] = React.useState('');
  const [nameAr, setNameAr] = React.useState(props.company?.nameAr ?? '');
  const [nameEn, setNameEn] = React.useState(props.company?.nameEn ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function submit(): Promise<void> {
    setError(null);
    if (nameAr.trim() === '' || nameEn.trim() === '') {
      setError(t('structure.saveFailed'));
      return;
    }
    if (props.mode === 'create' && !/^\d+$/.test(code.trim())) {
      setError(t('structure.saveFailed'));
      return;
    }
    setSaving(true);
    try {
      const err = await props.save({
        ...(props.mode === 'create' ? { code: Number(code.trim()) } : {}),
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim(),
      });
      if (err !== null) {
        setError(err);
        return;
      }
      props.onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {props.mode === 'create' ? t('structure.addCompany') : t('structure.editCompany')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {props.mode === 'create' ? (
            <div className="space-y-1">
              <Label htmlFor="company-code">{t('structure.fieldCode')}</Label>
              <Input
                id="company-code"
                dir="ltr"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="company-name-ar">{t('structure.fieldNameAr')}</Label>
            <Input
              id="company-name-ar"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="company-name-en">{t('structure.fieldNameEn')}</Label>
            <Input
              id="company-name-en"
              dir="ltr"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {t('structure.dialogCancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {t('structure.dialogSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
