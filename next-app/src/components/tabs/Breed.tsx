'use client'

import BreedingFlow from '../BreedingFlow'
import type { ChildResult } from '../../lib/inft'

type Props = {
  onContinue?: () => void
  onChildrenReady?: (children: ChildResult[]) => void
}

export default function Breed({ onContinue, onChildrenReady }: Props) {
  return (
    <BreedingFlow
      onContinue={onContinue}
      onChildrenReady={onChildrenReady}
    />
  )
}
