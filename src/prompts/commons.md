Write Wikimedia Commons searches for the scenes of the video "{{title}}". Commons holds real photos of real places, buildings, stores and people, found by the words in each photo's title and description.

For each scene, write two searches:
- When the scene is about a specific place, store, company or person, name it plainly, like "Walmart Supercenter", "Piggly Wiggly", "Fairfield Alabama" or "McDowell County West Virginia".
- When the video is about a company and the scene shows something of that company's, even if the description doesn't name it (its warehouses, workers, vans, trucks, packages, stores, website or logo), name the company in both searches, like "Amazon fulfillment center interior" or "Amazon delivery van".
- Otherwise, name the subject the way a photographer would title the photo, like "county courthouse", "strip mall" or "main street small town".

Then, if the video is mainly about one company, give:
- company: its name as photographers write it in photo titles ("Amazon", "Walmart", "Red Lobster"), or null if the video isn't about a company.
- companySearches: four to six Commons searches for the company's own things people photograph, the ones that show its name or logo, like "Amazon Prime van", "Amazon Prime truck", "Amazon fulfillment center", "Amazon Robotics" or "Walmart Supercenter sign". Not its executives.
- for each scene, company: true when the narration is about the company or something of its own (its buildings, workers, vehicles, deliveries, prices, website or decisions), false otherwise, such as a rival's store, a school or a city service.

{{scenes}}
