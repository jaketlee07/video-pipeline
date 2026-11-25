Plan the aerial shots for the video "{{title}}". In each scene below, the camera flies down onto a real place using US aerial imagery, and the place is looked up on OpenStreetMap by your words. The shot ends on the whole town, or on one site in it, which gets circled.

For each scene, give:
- place: the town, city neighborhood or county the scene is about. Its label is shown on screen, like "Fairfield, Alabama". Its query is the lookup, with the county and state, like "Fairfield, Jefferson County, Alabama"; for a city neighborhood, the city and state, like "Chatham, Chicago, Illinois".
- site: only when the scene is about one spot within that place that a map would list by name, such as a mall, a road, a plant, a courthouse or a store that's still there, like "Western Hills Mall, Fairfield, Alabama" or "Diamond Hill Road, Woonsocket, Rhode Island". Its label is the spot's name, like "Western Hills Mall". A closed store usually isn't on the map under its old name: name what's there now when you know it (the mall it was next to, the road it was on), or leave site null. Otherwise null.
- For a scene that shows its site before and after, the site is the building or lot itself, the way the map names it (like "Amazon BHM1, Bessemer, Alabama" or "Western Hills Mall, Fairfield, Alabama"), never the road it's on: the view is centered on it, and if it can't be found, the scene gets the zoom instead.

{{scenes}}
