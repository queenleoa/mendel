'use client'

import BreedingFlow from '../BreedingFlow'
import type { BreedFlowResult } from '../../lib/inft'

type Props = {
  onContinue?: () => void
  onBreedComplete?: (result: BreedFlowResult) => void
  initialResult?: BreedFlowResult | null
}

export default function Breed({ onContinue, onBreedComplete, initialResult }: Props) {
  return (
    <BreedingFlow
      onContinue={onContinue}
      onBreedComplete={onBreedComplete}
      initialResult={initialResult}
    />
  )
}
