import BreedingFlow from '../BreedingFlow'

type Props = {
  onContinue?: () => void
}

export default function Breed({ onContinue }: Props) {
  return <BreedingFlow onContinue={onContinue} />
}
