import { useLocalStorage } from '@mantine/hooks';

export type ProductionDisplayUnit = 'batches' | 'pieces';

export function useProductionDisplayUnit() {
  const [displayUnit, setDisplayUnit] = useLocalStorage<ProductionDisplayUnit>({
    key: 'production-display-unit',
    defaultValue: 'batches',
  });

  return [displayUnit, setDisplayUnit] as const;
}
