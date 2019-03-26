const { useState, useEffect } = React = require('react')
const { connect } = require('react-redux')

const {
  selectObject,
  selectObjectToggle,
  selectBone
} = require('../shared/reducers/shot-generator')

function getObjectsFromIcons ( objects ) {
  return objects
      // visible objects
      .filter(o => o.visible)
      // with icons
      .filter(o => o.orthoIcon && o.orthoIcon.icon)
      // return the icons
      .map(o => o.orthoIcon.icon)
      // and ...
      .concat(
        // ... add directly visible objects (like the box)
        objects
          .filter(o => o.type === 'Group' && o.children[0] && o.children[0].isMesh)
          .map(o => o.children[0])
      )
}

function getObjectsFromCameraView (objects) {
  let results = []

  for (let o of objects) {
    // console.log('found', o.userData)

    if (o.userData.type === 'object') {
      if (o.type === 'Group' && o.children[0].isMesh) {
        results.push(o.children[0])
      }
    }

    if (o.userData.type === 'character') {
      // if the mesh has loaded
      if (o.bonesHelper) {
        results = results.concat(o.bonesHelper.hit_meshes)
      }
    }

    if (o.userData.type === 'light') {
      results.push(o.hitter)
    }

    // if (o.userData.type === 'volume') {
    // }

    // TODO allow camera selection
    // if (o.userData.type === 'camera') {
    // }
  }

  return results
}

const getIntersectionTarget = intersect => {
  if (intersect.object.type === 'Sprite') {
    return intersect.object.parent.linkedTo
  }

  // light
  if (intersect.object.userData.type === 'hitter_light') {
    return intersect.object.parent
  }

  // character
  if (intersect.object.userData.type === 'hitter' ) {
    return intersect.object.parent.object3D
  }

  // object
  if (intersect.object.parent.userData.type === 'object') {
    return intersect.object.parent
  }
}

const SelectionManager = connect(
  state => ({
    selections: state.selections,
    sceneObjects: state.sceneObjects
  }),
  {
    selectObject,
    selectObjectToggle,
    selectBone
  }
)(
  ({
    scene,
    camera,
    el,

    selectOnPointerDown,
    useIcons,

    selections,
    sceneObjects,

    selectObject,
    selectObjectToggle,
    selectBone
  }) => {

  const [lastDownId, setLastDownId] = useState()

  const intersectables = scene.children.filter(o =>
    o.userData.type === 'object' ||
    o.userData.type === 'character' ||
    o.userData.type === 'light' ||
    o.userData.type === 'volume' ||
    (useIcons && o.isPerspectiveCamera)
  )

  const mouse = event => {
    const rect = el.getBoundingClientRect()
    return {
      x: ( ( event.clientX - rect.left ) / rect.width ) * 2 - 1,
      y: - ( ( event.clientY - rect.top ) / rect.height ) * 2 + 1
    }
  }

  const getIntersects = ({ x, y }, camera) => {
    let raycaster = new THREE.Raycaster()
    raycaster.setFromCamera({ x, y }, camera )

    let intersects = useIcons
      ? raycaster.intersectObjects( getObjectsFromIcons(intersectables) )
      : raycaster.intersectObjects( getObjectsFromCameraView(intersectables) )

    return intersects
  }

  const onPointerDown = event => {
    event.preventDefault()

    const { x, y } = mouse(event)

    let intersects = getIntersects({ x, y }, camera)

    if (intersects.length === 0) {
      setLastDownId(undefined)

      if (selectOnPointerDown) {
        selectObject(undefined)
        selectBone(undefined)
      }
      return
    }

    let target

    // prefer the nearest character to the click
    if (useIcons) {
      // how many characters intersections are there?
      let charactersIntersects = intersects.filter(i => i.object.parent.linkedTo && i.object.parent.linkedTo.userData.type === 'character')

      let intersect
      // if there are many character intersections
      if (charactersIntersects.length > 1) {
        // find the character intersection closest to the intersection point
        let closest = charactersIntersects[0]

        let linkedPosition = charactersIntersects[0].object.parent.linkedTo.position.clone().setY(0)
        let closestDist = linkedPosition.distanceTo(charactersIntersects[0].point)

        for (let intersector of charactersIntersects) {
          linkedPosition = intersector.object.parent.linkedTo.position.clone().setY(0)
          let newDist = linkedPosition.distanceTo(intersector.point)
          if (newDist < closestDist){
            closestDist = newDist
            closest = intersector
          }
        }

        intersect = closest
      } else if (charactersIntersects.length == 1) {
        // if there is only one character intersection, prefer that
        intersect = charactersIntersects[0]
      } else {
        // otherwise, grab the first intersection available
        intersect = intersects[0]
      }

      target = getIntersectionTarget(intersect)
    } else {
      target = getIntersectionTarget(intersects[0])
    }

    if (selections.length) {
      if (target.userData.type === 'character' && selections.includes(target.userData.id)) {
        let raycaster = new THREE.Raycaster()
        raycaster.setFromCamera({ x, y }, camera )
        let hits = raycaster.intersectObject(target.bonesHelper)

        if (hits.length) {
          selectObject(target.userData.id)
          setLastDownId(undefined)

          selectBone(hits[0].bone.uuid)
          return
        }
      }
    }

    selectBone(null)

    if (selectOnPointerDown) {
      event.shiftKey
        ? selectObjectToggle(target.userData.id)
        : selectObject(target.userData.id)
    } else {
      setLastDownId(target.userData.id)
    }
  }

  const onPointerUp = event => {
    event.preventDefault()

    const { x, y } = mouse(event)

    if (event.target === el) {
      if (!selectOnPointerDown) {
        let intersects = getIntersects({ x, y }, camera)

        if (intersects.length === 0) {
          selectObject(undefined)
          selectBone(null)
          return
        }

        let target = getIntersectionTarget(intersects[0])

        if (target.userData.id === lastDownId) {
          event.shiftKey
            ? selectObjectToggle(target.userData.id)
            : selectObject(target.userData.id)
          selectBone(null)
        }
      }
    }

    setLastDownId(undefined)
  }

  useEffect(() => {
    el.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onPointerUp)

    return function cleanup () {
      el.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onPointerUp)
    }
  }, [onPointerDown, onPointerUp])

  return null
})

module.exports = SelectionManager
