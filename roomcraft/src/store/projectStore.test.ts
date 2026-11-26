import { useProject } from './projectStore';
import { newProject } from '../model/room';

describe('command history', () => {
  beforeEach(() => useProject.getState().load(newProject('T')));

  it('undoes and redoes labelled commands', () => {
    const s = useProject.getState;
    s().apply('Rename', (d) => {
      d.name = 'A';
    });
    s().apply('Rename', (d) => {
      d.name = 'B';
    });
    expect(s().project.name).toBe('B');
    s().undo();
    expect(s().project.name).toBe('A');
    s().undo();
    expect(s().project.name).toBe('T');
    s().redo();
    expect(s().project.name).toBe('A');
    expect(s().future).toHaveLength(1);
    s().apply('Rename', (d) => {
      d.name = 'C';
    });
    expect(s().future).toHaveLength(0);
  });

  it('collapses a gesture into one command', () => {
    const s = useProject.getState;
    s().beginGesture('Drag');
    for (let i = 0; i < 10; i++)
      s().applyTransient((d) => {
        d.name = `n${i}`;
      });
    s().endGesture();
    expect(s().past).toHaveLength(1);
    expect(s().past[0].label).toBe('Drag');
    s().undo();
    expect(s().project.name).toBe('T');
  });

  it('ignores no-op commands', () => {
    const s = useProject.getState;
    s().apply('Nothing', () => {});
    expect(s().past).toHaveLength(0);
  });
});
