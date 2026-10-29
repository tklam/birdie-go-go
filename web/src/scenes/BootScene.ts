import Phaser from 'phaser';

/** Loads shared assets, then hands over to the title screen. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Title');
  }
}
