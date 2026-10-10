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

export interface ProjectFormValues {
  code?: string;
  nameAr: string;
  nameEn: string;
  companyId: string;
}

/**
 * Create (code + names + parent company, prefilled and locked to the
 * context row) or rename (names only — code is part of the serial
 * convention and immutable).
 */
export function ProjectDialog(props: {
  mode: 'create' | 'edit';
  companyId: string;
  companyName: string;
  project?: { id: string; nameAr: string; nameEn: string };
  save: (values: ProjectFormValues) => Promise<string | null>;
  onClose: () => void;
}): JSX.Element {
  const t = useTranslations('admin');
  const [code, setCode] = React.useState('');
  const [nameAr, setNameAr] = React.useState(props.project?.nameAr ?? '');
  const [nameEn, setNameEn] = React.useState(props.project?.nameEn ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function submit(): Promise<void> {
    setError(null);
    if (nameAr.trim() === '' || nameEn.trim() === '') {
      setError(t('structure.saveFailed'));
      return;
    }
    if (props.mode === 'create' && code.trim() === '') {
      setError(t('structure.saveFailed'));
      return;
    }
    setSaving(true);
    try {
      const err = await props.save({
        ...(props.mode === 'create' ? { code: code.trim() } : {}),
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim(),
        companyId: props.companyId,
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
            {props.mode === 'create' ? t('structure.addProject') : t('structure.editProject')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {props.mode === 'create' ? (
            <div className="space-y-1">
              <Label htmlFor="project-code">{t('structure.fieldCode')}</Label>
              <Input
                id="project-code"
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="project-name-ar">{t('structure.fieldNameAr')}</Label>
            <Input
              id="project-name-ar"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="project-name-en">{t('structure.fieldNameEn')}</Label>
            <Input
              id="project-name-en"
              dir="ltr"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="project-company">{t('structure.fieldCompany')}</Label>
            <Input id="project-company" value={props.companyName} disabled />
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
