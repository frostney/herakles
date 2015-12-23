# herakles
Slay the multi-repository monster and manage multiple repositories with a simple interface.

Managing multiple repositories is hard. Trying to stay up-to-date on all your machines is even harder. You may have tried putting your repository in your Dropbox, a different cloud provider or using BitTorrent Sync. You might have a put code in a virtual machine and then sync'ed your virtual machine across multiple machines. (I did all those things!)
But there are some shortcomings with all of those and chances are your repository is already centralized on Github, Bitbucket or on your own hosted platform, so we only need sync our repositories with that centralized repository.

For anyone seeing this, this a small project for managing multiple repositories as a library and as a command-line interface. I am incubating and testing this over winter break 2015 to see if it's worth being turned into a real project or if it should stay as an experiment.

TODO:
- [ ] Dogfood for a week
- [ ] Unit tests
- [ ] Scripts

Decisions:
- I'm not liking the tree-like structure with passing down `root` and `name`. Maybe have two with groups and repositories and repositories linking to the group. Not sure about the serialization though :/

If you are a fan of the monorepo approach, you might want to check out lerna.
