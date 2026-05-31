import { Component, ElementRef, Input, ViewChild, inject } from '@angular/core';

@Component({
  selector: 'app-help-popover',
  templateUrl: './help-popover.component.html',
  styleUrl: './help-popover.component.css',
})
export class HelpPopoverComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;

  @Input({ required: true }) text!: string;
  @Input() label = 'More information';
  @Input() interactive = true;

  protected panelLeft = 0;
  protected panelTop = 0;
  protected panelWidth = 320;
  protected arrowLeft = 160;
  protected placement: 'above' | 'below' = 'below';
  protected open = false;

  protected openPanel(): void {
    this.positionPanel();
    this.open = true;
  }

  protected closePanel(): void {
    this.open = false;
  }

  protected positionPanel(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.min(340, viewportWidth - margin * 2);
    const minWidth = Math.min(220, maxWidth);
    const rect = this.host.nativeElement.getBoundingClientRect();
    const estimatedTextWidth = Math.min(maxWidth, Math.max(minWidth, this.text.length * 4.8));
    const width = Math.min(maxWidth, estimatedTextWidth);
    const idealLeft = rect.left + rect.width / 2 - width / 2;
    const panelHeight = this.estimatedPanelHeight(width);
    const belowTop = rect.bottom + 10;
    const aboveTop = rect.top - panelHeight - 10;
    const hasRoomBelow = belowTop + panelHeight <= viewportHeight - margin;
    const top = hasRoomBelow || aboveTop < margin ? belowTop : aboveTop;

    this.panelWidth = width;
    this.panelLeft = Math.min(viewportWidth - margin - width, Math.max(margin, idealLeft));
    this.panelTop = Math.min(viewportHeight - margin - panelHeight, Math.max(margin, top));
    this.arrowLeft = Math.min(width - 18, Math.max(18, rect.left + rect.width / 2 - this.panelLeft));
    this.placement = this.panelTop < rect.top ? 'above' : 'below';
  }

  private estimatedPanelHeight(width: number): number {
    const charactersPerLine = Math.max(26, Math.floor(width / 6.5));
    const lines = Math.ceil(this.text.length / charactersPerLine);
    return Math.min(190, Math.max(54, lines * 18 + 28));
  }
}


