import { Notice } from '../../components/ui';

/** The standing safety and training notice. Reviewed by the trainer's engineer. */
export function SafetyNotice() {
  return (
    <Notice kind="warn">
      <p><strong>Training only.</strong> This app teaches UK practice: the Electricity at Work Regulations 1989, BS 7671 and HSE guidance. <strong>Your site procedures, permits and the person in control of the work always come first.</strong></p>
      <p>The simulators are simplified and never connect to real equipment. An app score never makes anyone competent or authorised. Only an observed practical, signed off by your trainer, counts towards that.</p>
    </Notice>
  );
}
