// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). The fields
// are strings, so a scene variable fits too (`{{triggerEvent.data.task_id}}`).
//
//   - `add_task`: add a task to the Mindwtr inbox ("buy bread" from a
//     button, a voice command), with a due date and contexts if given;
//   - `complete_task`: mark an open task done, by its exact title or its id;
//   - `read_today`: today's and overdue tasks as a sentence, for a message
//     or a voice announcement in the morning.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async add_task(hub, { fields = {} }) {
    const { id, title, dueDate } = await hub.create({
      title: fields.title,
      due: fields.due_date,
      context: fields.context,
    });
    return { task: title, task_id: id, due_date: dueDate };
  },

  async complete_task(hub, { fields = {} }) {
    const { task } = await hub.complete(fields.task);
    return { task: task.title, task_id: task.id };
  },

  async read_today(hub, { fields = {} }) {
    return hub.today(fields.context);
  },
};
