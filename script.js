const STORAGE_KEY = 'pwp.v1';
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const weekOverview = document.getElementById('weekOverview');
const dayTitle = document.getElementById('dayTitle');
const dayContent = document.querySelector('.day-content');
const quickInput = document.querySelector('.quick-input');
const prevWeekButton = document.querySelector('.icon-btn[aria-label="Предыдущая неделя"]');
const nextWeekButton = document.querySelector('.icon-btn[aria-label="Следующая неделя"]');
const todayButton = document.querySelector('.today-btn');

const state = {
  selectedDate: startOfDay(new Date()),
  tasks: [],
  editingTaskId: null,
  pendingDeleteTaskId: null,
  draggedTaskId: null,
  lastRenderedDateKey: null,
};

const storage = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map((task) => normalizeTask(task)).filter(Boolean);
    } catch (error) {
      return [];
    }
  },
  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  },
};

const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
const dayMonthFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const titleFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

state.tasks = storage.load();

if (quickInput) {
  quickInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    const text = quickInput.value.trim();
    if (!text) {
      return;
    }

    createTask(text);
    quickInput.value = '';
  });
}

if (prevWeekButton) {
  prevWeekButton.addEventListener('click', () => shiftWeek(-1));
}

if (nextWeekButton) {
  nextWeekButton.addEventListener('click', () => shiftWeek(1));
}

if (todayButton) {
  todayButton.addEventListener('click', () => {
    setSelectedDate(new Date());
    render();
  });
}

render();

function render() {
  const selectedDateKey = toDateKey(state.selectedDate);
  const shouldAnimateDaySwitch = state.lastRenderedDateKey !== null && state.lastRenderedDateKey !== selectedDateKey;

  renderDayTitle();
  renderWeekSidebar();
  renderTasks(shouldAnimateDaySwitch);

  state.lastRenderedDateKey = selectedDateKey;
}

function renderDayTitle() {
  dayTitle.textContent = capitalize(titleFormatter.format(state.selectedDate));
}

function renderWeekSidebar() {
  weekOverview.innerHTML = '';

  const weekStart = getWeekStart(state.selectedDate);
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const dateKey = toDateKey(date);

    const chip = document.createElement('article');
    chip.className = 'day-chip';
    chip.role = 'button';
    chip.tabIndex = 0;
    chip.dataset.date = dateKey;

    if (isSameDay(date, state.selectedDate)) {
      chip.classList.add('active');
    }

    const weekday = document.createElement('span');
    weekday.className = 'weekday';
    weekday.textContent = capitalize(weekdayFormatter.format(date).replace('.', ''));

    const dateText = document.createElement('span');
    dateText.className = 'date';
    dateText.textContent = dayMonthFormatter.format(date);
    const meta = document.createElement('span');
    meta.className = 'day-meta';
    meta.append(dateText);

    const activeCount = getActiveTaskCountByDateKey(dateKey);
    if (activeCount > 0) {
      const indicator = document.createElement('span');
      indicator.className = 'day-indicator';
      indicator.textContent = activeCount > 9 ? '9+' : String(activeCount);
      meta.append(indicator);
    }

    chip.append(weekday, meta);

    chip.addEventListener('click', () => {
      setSelectedDate(date);
      render();
    });

    chip.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setSelectedDate(date);
        render();
      }
    });

    chip.addEventListener('dragenter', (event) => {
      if (!state.draggedTaskId) {
        return;
      }
      event.preventDefault();
      highlightDropTarget(chip);
    });

    chip.addEventListener('dragover', (event) => {
      if (!state.draggedTaskId) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      highlightDropTarget(chip);
    });

    chip.addEventListener('dragleave', (event) => {
      if (!state.draggedTaskId) {
        return;
      }
      const nextTarget = event.relatedTarget;
      if (!(nextTarget instanceof Node) || !chip.contains(nextTarget)) {
        chip.classList.remove('is-drop-target');
      }
    });

    chip.addEventListener('drop', (event) => {
      if (!state.draggedTaskId) {
        return;
      }
      event.preventDefault();
      const draggedTaskId = state.draggedTaskId;
      state.draggedTaskId = null;
      clearDropTargets();
      setTaskDate(draggedTaskId, dateKey);
    });

    weekOverview.append(chip);
  }
}

function shiftWeek(weeks) {
  const nextDate = new Date(state.selectedDate);
  nextDate.setDate(nextDate.getDate() + weeks * 7);
  setSelectedDate(nextDate);
  render();
}

function renderTasks(shouldAnimateDaySwitch = false) {
  if (!dayContent) {
    return;
  }

  dayContent.innerHTML = '';
  if (shouldAnimateDaySwitch) {
    triggerDaySwitchAnimation();
  }

  const today = startOfDay(new Date());
  const todayKey = toDateKey(today);
  const isTodaySelected = isSameDay(state.selectedDate, today);

  let hasCarryovers = false;
  if (isTodaySelected) {
    hasCarryovers = renderCarryoverSection(todayKey);
  }

  const taskList = document.createElement('div');
  taskList.className = 'task-list';

  const selectedDateKey = toDateKey(state.selectedDate);
  const tasksForSelectedDay = state.tasks
    .filter((task) => task.date === selectedDateKey)
    .sort(sortTasks);

  if (tasksForSelectedDay.length === 0) {
    renderEmptyState(hasCarryovers);
    return;
  }

  tasksForSelectedDay.forEach((task, index) => {
    const row = document.createElement('article');
    row.className = 'task-row';
    row.dataset.status = task.status;
    row.style.setProperty('--item-index', String(index));
    const isEditingTask = state.editingTaskId === task.id;

    if (!isEditingTask) {
      attachTaskDragHandlers(row, task.id);
    }

    const priorityButton = document.createElement('button');
    priorityButton.type = 'button';
    priorityButton.className = `priority-badge priority-${task.priority}`;
    priorityButton.setAttribute('aria-label', 'Изменить приоритет задачи');
    const priorityMeta = getPriorityMeta(task.priority);
    priorityButton.textContent = `${task.priority}-${priorityMeta.label}`;
    priorityButton.title = `Приоритет: ${priorityMeta.label}. Нажмите, чтобы изменить`;
    priorityButton.addEventListener('click', () => {
      task.priority = nextPriority(task.priority);
      storage.save();
      renderTasks();
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.status === 'completed';
    checkbox.setAttribute('aria-label', 'Изменить статус задачи');
    checkbox.addEventListener('change', () => {
      task.status = checkbox.checked ? 'completed' : 'active';
      state.pendingDeleteTaskId = null;
      storage.save();
      render();
    });

    const textWrap = document.createElement('span');
    textWrap.className = 'task-text-wrap';

    if (isEditingTask) {
      const editInput = document.createElement('input');
      editInput.type = 'text';
      editInput.value = task.text;
      editInput.className = 'task-edit-input';
      editInput.setAttribute('aria-label', 'Редактирование задачи');

      let editFinalized = false;

      const saveEdit = () => {
        if (editFinalized) {
          return;
        }
        editFinalized = true;

        const nextText = editInput.value.trim();
        state.editingTaskId = null;

        if (!nextText) {
          renderTasks();
          return;
        }

        if (task.text !== nextText) {
          task.text = nextText;
          storage.save();
        }

        renderTasks();
      };

      const cancelEdit = () => {
        if (editFinalized) {
          return;
        }
        editFinalized = true;
        state.editingTaskId = null;
        renderTasks();
      };

      editInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveEdit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelEdit();
        }
      });

      editInput.addEventListener('blur', saveEdit);
      textWrap.append(editInput);
    } else {
      const textButton = document.createElement('button');
      textButton.type = 'button';
      textButton.className = 'task-text';
      if (task.status === 'completed') {
        textButton.classList.add('is-completed');
      }
      if (task.status === 'postponed') {
        textButton.classList.add('is-postponed');
      }
      textButton.textContent = task.text;
      textButton.title = 'Нажмите для редактирования';
      textButton.addEventListener('click', () => {
        state.editingTaskId = task.id;
        state.pendingDeleteTaskId = null;
        renderTasks();
      });
      textWrap.append(textButton);
    }

    const datePickerInput = document.createElement('input');
    datePickerInput.type = 'date';
    datePickerInput.className = 'task-date-picker';
    datePickerInput.value = task.date;
    datePickerInput.setAttribute('aria-label', 'Дата задачи');
    datePickerInput.addEventListener('change', () => {
      setTaskDate(task.id, datePickerInput.value);
    });

    const calendarButton = document.createElement('button');
    calendarButton.type = 'button';
    calendarButton.className = 'task-calendar';
    calendarButton.textContent = '📅';
    calendarButton.setAttribute('aria-label', 'Изменить дату задачи');
    calendarButton.title = 'Перенести задачу на выбранную дату';
    calendarButton.addEventListener('click', () => {
      datePickerInput.value = task.date;
      openDatePicker(datePickerInput);
    });

    const postponeButton = document.createElement('button');
    postponeButton.type = 'button';
    postponeButton.className = 'task-postpone';
    postponeButton.textContent = '⏸';
    postponeButton.setAttribute('aria-label', 'Отложить задачу');

    if (task.status === 'postponed') {
      postponeButton.classList.add('is-active');
    }

    if (task.status === 'completed') {
      postponeButton.disabled = true;
      postponeButton.title = 'Выполненную задачу нельзя отложить';
    } else {
      postponeButton.title = 'Отложить задачу';
      postponeButton.addEventListener('click', () => {
        if (task.status !== 'postponed') {
          task.status = 'postponed';
          state.pendingDeleteTaskId = null;
          storage.save();
          render();
        }
      });
    }

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'task-delete';
    deleteButton.textContent = state.pendingDeleteTaskId === task.id ? 'Подтвердить' : '🗑︎';
    deleteButton.setAttribute('aria-label', 'Удалить задачу');
    deleteButton.addEventListener('click', () => {
      handleDelete(task.id);
    });

    row.append(priorityButton, checkbox, textWrap, calendarButton, postponeButton, deleteButton, datePickerInput);
    taskList.append(row);
  });

  dayContent.append(taskList);

  const editInput = dayContent.querySelector('.task-edit-input');
  if (editInput) {
    editInput.focus();
    editInput.select();
  }
}

function renderCarryoverSection(todayKey) {
  const carryovers = state.tasks
    .filter((task) => task.status === 'active' && task.date < todayKey)
    .sort((firstTask, secondTask) => firstTask.date.localeCompare(secondTask.date));

  if (carryovers.length === 0) {
    return false;
  }

  const section = document.createElement('section');
  section.className = 'carryover';
  section.setAttribute('aria-label', 'Хвосты');

  const heading = document.createElement('h2');
  heading.className = 'carryover-title';
  heading.textContent = 'Хвосты';
  section.append(heading);

  const list = document.createElement('div');
  list.className = 'carryover-list';

  carryovers.forEach((task, index) => {
    const row = document.createElement('article');
    row.className = 'carryover-row';
    row.style.setProperty('--item-index', String(index));
    attachTaskDragHandlers(row, task.id);

    const text = document.createElement('p');
    text.className = 'carryover-text';
    text.textContent = task.text;

    const origin = document.createElement('span');
    origin.className = 'carryover-origin';
    origin.textContent = `с ${formatDateLabel(task.date)}`;

    const controls = document.createElement('div');
    controls.className = 'carryover-controls';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'carryover-date';
    dateInput.value = todayKey;
    dateInput.min = todayKey;
    dateInput.setAttribute('aria-label', 'Дата переноса задачи');
    dateInput.addEventListener('input', () => {
      dateInput.classList.remove('is-invalid');
    });

    const moveButton = document.createElement('button');
    moveButton.type = 'button';
    moveButton.className = 'carryover-confirm';
    moveButton.textContent = 'Перенести';
    moveButton.addEventListener('click', () => {
      if (!moveTaskToDate(task.id, dateInput.value, todayKey)) {
        dateInput.classList.add('is-invalid');
      }
    });

    const todayButton = document.createElement('button');
    todayButton.type = 'button';
    todayButton.className = 'carryover-today';
    todayButton.textContent = 'На сегодня';
    todayButton.addEventListener('click', () => {
      moveTaskToDate(task.id, todayKey, todayKey);
    });

    controls.append(dateInput, moveButton, todayButton);
    row.append(text, origin, controls);
    list.append(row);
  });

  section.append(list);
  dayContent.append(section);
  return true;
}

function createTask(text) {
  const task = {
    id: createTaskId(),
    text,
    date: toDateKey(state.selectedDate),
    priority: 2,
    status: 'active',
  };

  state.tasks.push(task);
  state.pendingDeleteTaskId = null;
  state.editingTaskId = null;
  storage.save();
  render();
}

function handleDelete(taskId) {
  if (state.pendingDeleteTaskId !== taskId) {
    state.pendingDeleteTaskId = taskId;
    renderTasks();
    return;
  }

  state.tasks = state.tasks.filter((task) => task.id !== taskId);
  state.pendingDeleteTaskId = null;
  state.editingTaskId = null;
  storage.save();
  render();
}

function setSelectedDate(date) {
  state.selectedDate = startOfDay(date);
  state.pendingDeleteTaskId = null;
  state.editingTaskId = null;
}

function sortTasks(firstTask, secondTask) {
  const statusOrder = {
    active: 0,
    postponed: 1,
    completed: 2,
  };

  const statusDiff = statusOrder[firstTask.status] - statusOrder[secondTask.status];
  if (statusDiff !== 0) {
    return statusDiff;
  }

  if (firstTask.status === 'active' && secondTask.status === 'active') {
    return secondTask.priority - firstTask.priority;
  }

  return 0;
}

function getWeekStart(date) {
  const normalized = startOfDay(date);
  const mondayOffset = (normalized.getDay() + 6) % 7;
  normalized.setDate(normalized.getDate() - mondayOffset);
  return normalized;
}

function startOfDay(date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function isSameDay(firstDate, secondDate) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateKey) {
  const [year, month, day] = dateKey.split('-').map((value) => Number(value));
  const date = new Date(year, month - 1, day);
  return dayMonthFormatter.format(date);
}

function moveTaskToDate(taskId, targetDateKey, todayKey) {
  if (!DATE_KEY_PATTERN.test(targetDateKey)) {
    return false;
  }

  if (targetDateKey < todayKey) {
    return false;
  }

  return setTaskDate(taskId, targetDateKey);
}

function setTaskDate(taskId, targetDateKey) {
  if (!DATE_KEY_PATTERN.test(targetDateKey)) {
    return false;
  }

  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return false;
  }

  if (task.date === targetDateKey) {
    return true;
  }

  task.date = targetDateKey;
  state.pendingDeleteTaskId = null;
  state.editingTaskId = null;
  storage.save();
  render();
  return true;
}

function attachTaskDragHandlers(element, taskId) {
  element.draggable = true;

  element.addEventListener('dragstart', (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(
        'input, .priority-badge, .task-calendar, .task-postpone, .task-delete, .carryover-confirm, .carryover-today'
      )
    ) {
      event.preventDefault();
      return;
    }

    state.draggedTaskId = taskId;
    element.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', taskId);
    }
  });

  element.addEventListener('dragend', () => {
    state.draggedTaskId = null;
    element.classList.remove('is-dragging');
    clearDropTargets();
  });
}

function highlightDropTarget(chip) {
  clearDropTargets();
  chip.classList.add('is-drop-target');
}

function clearDropTargets() {
  const activeTargets = document.querySelectorAll('.day-chip.is-drop-target');
  activeTargets.forEach((item) => {
    item.classList.remove('is-drop-target');
  });
}

function renderEmptyState(hasCarryovers) {
  const emptyState = document.createElement('section');
  emptyState.className = 'task-empty-state';
  if (hasCarryovers) {
    emptyState.classList.add('with-carryovers');
  }

  const title = document.createElement('p');
  title.className = 'task-empty-title';
  title.textContent = 'Свободный день. Время для отдыха.';

  const hint = document.createElement('p');
  hint.className = 'task-empty-hint';
  hint.textContent = 'Добавьте задачу снизу, если захотите распланировать день.';

  emptyState.append(title, hint);
  dayContent.append(emptyState);
}

function triggerDaySwitchAnimation() {
  if (!dayContent) {
    return;
  }

  dayContent.classList.remove('is-day-switching');
  // Force reflow so repeated transitions replay correctly.
  void dayContent.offsetWidth;
  dayContent.classList.add('is-day-switching');
}

function getActiveTaskCountByDateKey(dateKey) {
  return state.tasks.reduce((count, task) => {
    if (task.date === dateKey && task.status === 'active') {
      return count + 1;
    }
    return count;
  }, 0);
}

function openDatePicker(input) {
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
      return;
    } catch (error) {
      // Fallback for browsers that block showPicker in specific contexts.
    }
  }
  input.focus({ preventScroll: true });
  input.click();
}

function createTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function getPriorityMeta(priority) {
  if (priority === 1) {
    return { label: 'Low' };
  }
  if (priority === 3) {
    return { label: 'High' };
  }
  return { label: 'Med' };
}

function nextPriority(priority) {
  if (priority === 1) {
    return 2;
  }
  if (priority === 2) {
    return 3;
  }
  return 1;
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object') {
    return null;
  }

  const text = typeof task.text === 'string' ? task.text.trim() : '';
  if (!text) {
    return null;
  }

  const date = typeof task.date === 'string' && DATE_KEY_PATTERN.test(task.date) ? task.date : toDateKey(new Date());
  const rawStatus = task.status === 'done' ? 'completed' : task.status;
  const status = rawStatus === 'active' || rawStatus === 'postponed' || rawStatus === 'completed' ? rawStatus : 'active';
  const priority = [1, 2, 3].includes(Number(task.priority)) ? Number(task.priority) : 2;

  return {
    id: typeof task.id === 'string' && task.id ? task.id : createTaskId(),
    text,
    date,
    priority,
    status,
  };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
