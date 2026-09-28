'use strict'
// ── drag to reorder ──────────────────────────────────────────────────────────
// Cards carrying data-sort-group / data-sort-id can be dragged within their group.
// Pointer events rather than HTML drag-and-drop: with these the card itself follows
// the pointer (the browser's drag image is a faint snapshot), the other cards slide
// out of its way, the list scrolls when the card nears its edge, and the card glides
// into its new place when let go. Esc puts it back where it was.

const Sortable = { active: false, pending: false }

function enableSorting (list, { onDrop, onIdle }) {
  const THRESHOLD = 6 // pixels of movement before a press becomes a drag, not a click
  const EDGE = 56 // how close to the list's edge the pointer must be to scroll it
  let press = null
  let drag = null
  let swallowClick = false

  const group = (name) => [...list.querySelectorAll(`[data-sort-group="${name}"]`)]
  const others = () => group(drag.group).filter((el) => el !== drag.card)

  list.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return
    const card = event.target.closest('[data-sort-group]')
    if (!card || !list.contains(card)) return
    // Buttons, stars and fields keep their own clicks.
    if (event.target.closest('button, input, select, a, .stars')) return
    if (group(card.dataset.sortGroup).length < 2) return
    press = { card, x: event.clientX, y: event.clientY, id: event.pointerId }
  })

  window.addEventListener('pointermove', (event) => {
    if (drag) {
      event.preventDefault()
      follow(event.clientY)
      return
    }
    if (!press || event.pointerId !== press.id) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < THRESHOLD) return
    start()
    follow(event.clientY)
  })
  window.addEventListener('pointerup', () => {
    press = null
    if (drag) finish(true)
  })
  window.addEventListener('pointercancel', () => {
    press = null
    if (drag) finish(false)
  })
  window.addEventListener('keydown', (event) => {
    if (drag && event.key === 'Escape') finish(false)
  })
  // The click that ends a drag must not also select or play the song.
  list.addEventListener('click', (event) => {
    if (!swallowClick) return
    swallowClick = false
    event.stopPropagation()
    event.preventDefault()
  }, true)

  function start () {
    const card = press.card
    const rect = card.getBoundingClientRect()
    const placeholder = document.createElement('div')
    placeholder.className = 'song-placeholder'
    placeholder.style.height = `${rect.height}px`
    list.insertBefore(placeholder, card)
    drag = {
      card,
      group: card.dataset.sortGroup,
      placeholder,
      grab: press.y - rect.top,
      startIndex: group(card.dataset.sortGroup).indexOf(card),
      lastY: press.y,
      frame: 0
    }
    press = null
    Sortable.active = true
    document.body.classList.add('sorting')
    card.classList.add('dragging')
    // Lifted out of the flow and pinned to the viewport; the placeholder holds its
    // place in the list until the drop.
    Object.assign(card.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', zIndex: '100'
    })
    drag.frame = requestAnimationFrame(autoScroll)
  }

  function follow (y) {
    drag.lastY = y
    drag.card.style.top = `${y - drag.grab}px`
    place(y)
  }

  // The gap moves to wherever the dragged card's centre now is.
  function place (y) {
    const siblings = others()
    const centre = y - drag.grab + drag.card.offsetHeight / 2
    const before = siblings.find((el) => {
      const r = el.getBoundingClientRect()
      return centre < r.top + r.height / 2
    }) || null
    const next = following(drag.placeholder)
    if (next === before) return
    slide(siblings, () => {
      if (before) list.insertBefore(drag.placeholder, before)
      else siblings[siblings.length - 1].after(drag.placeholder)
    })
  }

  // The next card of the same group after `el`, skipping the one being dragged.
  function following (el) {
    for (let node = el.nextElementSibling; node; node = node.nextElementSibling) {
      if (node === drag.card) continue
      return node.dataset.sortGroup === drag.group ? node : null
    }
    return null
  }

  // FLIP: note where every card is, move the gap, then animate each card from its old
  // place to its new one.
  function slide (cards, change) {
    const before = new Map(cards.map((el) => [el, el.getBoundingClientRect().top]))
    change()
    for (const el of cards) {
      const delta = before.get(el) - el.getBoundingClientRect().top
      if (!delta) continue
      el.style.transition = 'none'
      el.style.transform = `translateY(${delta}px)`
      el.getBoundingClientRect() // commit the starting position before animating
      el.style.transition = 'transform 160ms ease'
      el.style.transform = ''
    }
  }

  function autoScroll () {
    if (!drag) return
    const box = list.getBoundingClientRect()
    let speed = 0
    if (drag.lastY < box.top + EDGE) speed = -Math.ceil((box.top + EDGE - drag.lastY) / 4)
    else if (drag.lastY > box.bottom - EDGE) speed = Math.ceil((drag.lastY - box.bottom + EDGE) / 4)
    if (speed) {
      const before = list.scrollTop
      list.scrollTop += speed
      if (list.scrollTop !== before) place(drag.lastY)
    }
    drag.frame = requestAnimationFrame(autoScroll)
  }

  function finish (commit) {
    const { card, placeholder, startIndex } = drag
    cancelAnimationFrame(drag.frame)
    if (!commit) {
      // Back to where it came from.
      const siblings = others()
      slide(siblings, () => {
        if (startIndex < siblings.length) list.insertBefore(placeholder, siblings[startIndex])
        else siblings[siblings.length - 1].after(placeholder)
      })
    }
    swallowClick = true
    setTimeout(() => { swallowClick = false }, 0)
    // Glide into the gap, then take its place.
    const target = placeholder.getBoundingClientRect()
    card.style.transition = 'top 160ms ease, left 160ms ease'
    card.style.top = `${target.top}px`
    card.style.left = `${target.left}px`
    const settle = () => {
      if (!drag || drag.card !== card) return
      placeholder.replaceWith(card)
      card.classList.remove('dragging')
      card.removeAttribute('style')
      document.body.classList.remove('sorting')
      const ids = group(drag.group).map((el) => el.dataset.sortId)
      const moved = ids.indexOf(card.dataset.sortId) !== startIndex
      const name = drag.group
      drag = null
      Sortable.active = false
      if (commit && moved) onDrop(name, ids)
      // Updates that arrived mid-drag were held back; show them now.
      if (Sortable.pending) {
        Sortable.pending = false
        onIdle()
      }
    }
    card.addEventListener('transitionend', settle, { once: true })
    setTimeout(settle, 220) // in case no transition runs (the card was already there)
  }
}
