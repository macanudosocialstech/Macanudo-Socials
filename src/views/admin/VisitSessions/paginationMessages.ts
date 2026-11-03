import type { TFunction } from 'i18next';

type PaginationKey = 'migration' | 'failed' | 'scope' | 'previous' | 'next' | 'page'
  | 'visits' | 'redemptions' | 'visitPageSize' | 'documentPageSize' | 'visitsUnit'
  | 'documentsUnit' | 'localItems' | 'searchPage';

export const paginationText = (t: TFunction, _language: string, key: PaginationKey, values = {}) =>
  t(`visitSessionsPagination.${key}`, values);
