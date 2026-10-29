import Phaser from 'phaser';
import type { CoreClient } from '../core/client';
import type { ContentBundle } from '../core/types.gen';
import { Session } from '../systems/session';
import { TEXT } from '../ui/text';

/** Title screen: New Game / Continue. Records <body data-boot> for automated checks. */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    (this.registry.get('music') as { stop(): void } | undefined)?.stop();
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x1b2a4a).setOrigin(0, 0);
    this.add.text(width / 2, 44, 'BIRDIE GO GO', { ...TEXT, fontSize: '16px', color: '#ffe680' }).setOrigin(0.5);
    this.add.text(width / 2, 62, 'a Tseung Kwan O story', { ...TEXT, color: '#c8d0e0' }).setOrigin(0.5);
    const status = this.add.text(width / 2, height - 10, '', { ...TEXT, color: '#6e6e80' }).setOrigin(0.5);

    const core = this.registry.get('core') as CoreClient;
    const content = this.registry.get('content') as ContentBundle;
    void Promise.all([core.ping('chirp'), Session.open(content, core)]).then(
      ([ping, { session, hasSave }]) => {
        this.registry.set('session', session);
        status.setText(`core v${ping.coreVersion} · content v${content.game.contentVersion}`);
        document.body.dataset.boot = 'ok';
        const options: [string, () => void][] = [];
        if (hasSave) options.push(['Continue', () => this.start()]);
        options.push([
          'New Game',
          () => {
            session.newGame();
            this.start();
          },
        ]);
        this.menu(options);
      },
      (err: unknown) => {
        document.body.dataset.boot = 'error';
        status.setColor('#c83c3c').setText(`Failed to start: ${String(err)}`);
      },
    );
  }

  private menu(options: [string, () => void][]): void {
    const { width } = this.scale;
    let selected = 0;
    const items = options.map(([label, run], i) => {
      const t = this.add
        .text(width / 2, 100 + i * 16, label, { ...TEXT, fontSize: '8px', color: '#f0f0f0' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => run());
      t.on('pointerover', () => {
        selected = i;
        render();
      });
      return t;
    });
    const cursor = this.add.text(0, 0, '▶', { ...TEXT, color: '#f0d050' }).setOrigin(1, 0.5);
    const render = () => {
      items.forEach((t, i) => t.setColor(i === selected ? '#f0d050' : '#f0f0f0'));
      cursor.setPosition(items[selected].x - items[selected].width / 2 - 4, items[selected].y);
    };
    render();
    const kb = this.input.keyboard;
    kb?.on('keydown-UP', () => {
      selected = (selected + items.length - 1) % items.length;
      render();
    });
    kb?.on('keydown-DOWN', () => {
      selected = (selected + 1) % items.length;
      render();
    });
    const confirm = () => options[selected][1]();
    kb?.on('keydown-ENTER', confirm);
    kb?.on('keydown-SPACE', confirm);
  }

  private start(): void {
    this.input.keyboard?.removeAllListeners();
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Map'));
  }
}
