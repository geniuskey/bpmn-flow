/** Align / distribute commands with their icons (header menu and multi-selection panel). */
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  type LucideIcon,
} from 'lucide-react';

export const ARRANGE_ITEMS: { id: string; icon: LucideIcon; separated?: boolean }[] = [
  { id: 'arrange.alignLeft', icon: AlignStartVertical },
  { id: 'arrange.alignCenter', icon: AlignCenterVertical },
  { id: 'arrange.alignRight', icon: AlignEndVertical },
  { id: 'arrange.alignTop', icon: AlignStartHorizontal, separated: true },
  { id: 'arrange.alignMiddle', icon: AlignCenterHorizontal },
  { id: 'arrange.alignBottom', icon: AlignEndHorizontal },
  { id: 'arrange.distributeHorizontal', icon: AlignHorizontalDistributeCenter, separated: true },
  { id: 'arrange.distributeVertical', icon: AlignVerticalDistributeCenter },
];
