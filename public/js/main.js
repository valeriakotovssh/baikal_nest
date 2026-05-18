document.querySelectorAll('[data-slider]').forEach((slider) => {
  const track = slider.querySelector('.slider-track');
  const prev = slider.querySelector('[data-prev]');
  const next = slider.querySelector('[data-next]');
  const step = 360;
  prev?.addEventListener('click', () => track.scrollBy({ left: -step, behavior: 'smooth' }));
  next?.addEventListener('click', () => track.scrollBy({ left: step, behavior: 'smooth' }));
});

const registerToggle = document.querySelector('[data-toggle-register]');
const registerForm = document.querySelector('[data-register-form]');
registerToggle?.addEventListener('click', () => {
  registerForm?.classList.toggle('hidden');
});

const loginTabs = document.querySelectorAll('[data-login-tab]');
const loginForms = document.querySelectorAll('[data-login-form]');
loginTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.loginTab;
    loginTabs.forEach((item) => item.classList.toggle('active', item === tab));
    loginForms.forEach((form) => form.classList.toggle('hidden', form.dataset.loginForm !== target));
    registerForm?.classList.add('hidden');
  });
});

function addDays(dateValue, days) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function todayString() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

document.querySelectorAll('form').forEach((form) => {
  const startInput = form.querySelector('input[name="start_date"]');
  const endInput = form.querySelector('input[name="end_date"]');
  if (!startInput || !endInput) return;

  const today = todayString();
  startInput.min = today;

  const syncEndDate = () => {
    if (!startInput.value) return;
    const minEndDate = addDays(startInput.value, 1);
    endInput.min = minEndDate;
    if (!endInput.value || endInput.value <= startInput.value) {
      endInput.value = minEndDate;
    }
  };

  startInput.addEventListener('change', syncEndDate);
  syncEndDate();
});

document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.classList.add('is-loading');
  });
});

document.querySelectorAll('[data-availability-calendar]').forEach((calendar) => {
  const form = calendar.closest('form');
  const houseInput = form?.querySelector('input[name="house_id"]');
  const startInput = form?.querySelector('input[name="start_date"]');
  const endInput = form?.querySelector('input[name="end_date"]');
  const dataNode = calendar.querySelector('[data-availability-data]');
  if (!form || !startInput || !endInput || !dataNode) return;

  let bookings = [];
  try {
    bookings = JSON.parse(dataNode.textContent || '[]');
  } catch {
    bookings = [];
  }

  const monthNames = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
  ];
  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const today = todayString();
  let selectedStart = startInput.value || '';
  let selectedEnd = endInput.value || '';
  let pickingEnd = Boolean(selectedStart && !selectedEnd);
  let currentMonth = new Date(`${selectedStart || today}T00:00:00`);
  currentMonth.setDate(1);

  const busyBookingForDate = (date) => bookings.find((booking) => booking.start_date <= date && booking.end_date > date);
  const isBusy = (date) => Boolean(busyBookingForDate(date));
  const isInSelectedRange = (date) => selectedStart && selectedEnd && selectedStart <= date && date < selectedEnd;
  const rangeHasBusyDate = (startDate, endDate) => {
    let date = startDate;
    while (date < endDate) {
      if (isBusy(date)) return true;
      date = addDays(date, 1);
    }
    return false;
  };

  function renderAvailabilityCalendar() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells = [];

    for (let index = 0; index < firstWeekday; index += 1) {
      cells.push('<span class="availability-day is-empty"></span>');
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const busyBooking = busyBookingForDate(date);
      const busy = Boolean(busyBooking);
      const past = date < today;
      const selected = date === selectedStart || date === selectedEnd;
      const inRange = isInSelectedRange(date);
      const classes = [
        'availability-day',
        busy ? 'is-busy' : 'is-free',
        past ? 'is-disabled' : '',
        selected ? 'is-selected' : '',
        inRange ? 'is-range' : ''
      ].filter(Boolean).join(' ');
      const label = busy ? `Занято: бронь №${busyBooking.id}` : 'Свободно';
      cells.push(`<button class="${classes}" type="button" data-date="${date}" title="${label}" aria-label="${date}: ${label}" ${past || busy ? 'disabled' : ''}><span>${day}</span><i></i></button>`);
    }

    calendar.innerHTML = `
      <script type="application/json" data-availability-data>${dataNode.textContent || '[]'}</script>
      <div class="availability-head">
        <button type="button" data-availability-prev aria-label="Предыдущий месяц">‹</button>
        <strong>${monthNames[month]} ${year}</strong>
        <button type="button" data-availability-next aria-label="Следующий месяц">›</button>
      </div>
      <div class="availability-legend"><span class="free-dot"></span>Свободно <span class="busy-dot"></span>Занято для этого домика</div>
      <div class="availability-weekdays">${weekDays.map((dayName) => `<span>${dayName}</span>`).join('')}</div>
      <div class="availability-grid">${cells.join('')}</div>
      <p class="availability-note">Красные даты уже заняты или ожидают подтверждения по этому домику.</p>
    `;
  }

  calendar.addEventListener('click', (event) => {
    const prev = event.target.closest('[data-availability-prev]');
    const next = event.target.closest('[data-availability-next]');
    const dayButton = event.target.closest('[data-date]');

    if (prev) {
      currentMonth.setMonth(currentMonth.getMonth() - 1);
      renderAvailabilityCalendar();
      return;
    }

    if (next) {
      currentMonth.setMonth(currentMonth.getMonth() + 1);
      renderAvailabilityCalendar();
      return;
    }

    if (!dayButton) return;
    const date = dayButton.dataset.date;

    if (!selectedStart || !pickingEnd || date <= selectedStart) {
      selectedStart = date;
      selectedEnd = addDays(date, 1);
      pickingEnd = true;
    } else if (rangeHasBusyDate(selectedStart, date)) {
      selectedStart = date;
      selectedEnd = addDays(date, 1);
      pickingEnd = true;
    } else {
      selectedEnd = date;
      pickingEnd = false;
    }

    startInput.value = selectedStart;
    endInput.value = selectedEnd;
    endInput.min = addDays(selectedStart, 1);
    renderAvailabilityCalendar();
  });

  startInput.addEventListener('change', () => {
    selectedStart = startInput.value;
    selectedEnd = endInput.value;
    pickingEnd = Boolean(selectedStart && (!selectedEnd || selectedEnd <= selectedStart));
    renderAvailabilityCalendar();
  });

  endInput.addEventListener('change', () => {
    selectedStart = startInput.value;
    selectedEnd = endInput.value;
    pickingEnd = false;
    renderAvailabilityCalendar();
  });

  renderAvailabilityCalendar();

  if (houseInput?.value) {
    fetch(`/api/houses/${houseInput.value}/availability`)
      .then((response) => (response.ok ? response.json() : []))
      .then((freshBookings) => {
        bookings = Array.isArray(freshBookings) ? freshBookings : [];
        renderAvailabilityCalendar();
      })
      .catch(() => {});
  }
});
