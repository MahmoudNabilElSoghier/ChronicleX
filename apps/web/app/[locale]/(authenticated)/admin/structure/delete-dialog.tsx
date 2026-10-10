'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Soft-delete confirmation. A 400 from the server (active projects / recorded
 * entries) renders its message inside the dialog — the delete stays blocked
 * visually, not just as a fleeting toast.
 */
export function DeleteDialog(props: {
  message: string;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const t = useTranslations('admin');
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('structure.deleteConfirmTitle')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm">{props.message}</p>
        {props.error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {props.error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onCancel}>
            {t('structure.dialogCancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={props.busy} onClick={props.onConfirm}>
            {t('structure.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
