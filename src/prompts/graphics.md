Prepare the on-screen graphics for the video "{{title}}". For each scene below, return the structured version of its on-screen text, as described for its type.

Number scenes show one big number with a short label under it:
- headline: the number as it should appear, at most about 10 characters, like "<1%", "$684.6M", "33–40%", "1 hr 10 min" or "4 of 8".
- label: the rest of the text, as a short phrase that reads naturally under the number, like "of Walmart's revenue". Keep any caveat or date that's in the text.
- count: when the headline is a single number that can count up from zero, how to count it, like {to: 684.6, decimals: 1, prefix: "$", suffix: "M"}. Otherwise null: ranges, fractions, times with two units, and numbers with "<", "~" or "about".

Title scenes show a short text card:
- style: "section" for a section opener, "quote" for a quote card, "question" when the narrator asks viewers a question, and "statement" for anything else.
- text: the words to show. Quotes go without the quotation marks or the speaker; a question for viewers goes without any "tell us in the comments".
- attribution: for a quote, who said it and, if given, their role, like "Mayor Kenneth Coachman". Otherwise null.
- A title "standing in for footage" replaces a shot that couldn't be found. Make it a "statement" showing the one fact or phrase from its narration a viewer should remember, in at most eight words, like "102 Walmart Express stores, all closed". Never describe a picture.

Map scenes show real places on a map of the United States:
- style: "pins" to mark one or more places, "route" for a trip between two places (start first), or "region" to highlight a whole state or county.
- places: for each place, a short label to show on the map (like "Fairfield"), a query a map search would find (like "Fairfield, Jefferson County, Alabama"), its state's full name, and its county (like "Jefferson County"), or null when the place is a whole state. Leave out places outside the United States.

{{scenes}}
