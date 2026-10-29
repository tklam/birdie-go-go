import Phaser from 'phaser';
import type { AudioEngine } from '../audio/AudioEngine';
import { backdrop, finish, intro, result, type MinigameData } from '../minigames/common';
import { answer, quizOver, startQuiz } from '../minigames/quiz';
import { showMenu } from '../ui/menu';
import { TEXT } from '../ui/text';

/**
 * The quiz mini game (SPEC.md §4.14): a local's questions about the place's
 * history, answered from a menu; win with `target` right answers.
 */
export class QuizScene extends Phaser.Scene {
  constructor() {
    super('MG_quiz');
  }

  create(data: MinigameData): void {
    backdrop(this, 0x2a1838);
    this.add.text(160, 20, data.game.title, { ...TEXT, color: '#ffe680' }).setOrigin(0.5);
    const score = this.add.text(160, 160, '', TEXT).setOrigin(0.5);
    const audio = this.registry.get('audio') as AudioEngine | undefined;
    void (async () => {
      for (;;) {
        await intro(data.game, `Answer at least ${data.game.target ?? 1} of ${data.game.quiz?.length ?? 0} questions right.`);
        const qs = data.game.quiz ?? [];
        const state = startQuiz();
        while (!quizOver(state, qs)) {
          const q = qs[state.index];
          score.setText(`Question ${state.index + 1}/${qs.length} · right ${state.right}`);
          let choice = -1;
          await showMenu(
            q.question,
            q.answers.map((a, i) => ({ label: a, run: async () => ((choice = i), false) })),
            { tapToSelect: false },
          );
          if (choice < 0) continue;
          const ok = answer(state, qs, choice);
          if (ok) audio?.chime();
          else audio?.buzz();
          score.setText(ok ? 'Right!' : `It was: ${q.answers[q.correct]}`);
          await new Promise((r) => this.time.delayedCall(ok ? 600 : 1400, r));
        }
        const won = state.right >= (data.game.target ?? qs.length);
        const again = await result(won, [`${state.right} of ${qs.length} right.`]);
        if (!again) {
          finish(this, data, won);
          return;
        }
      }
    })();
  }
}
